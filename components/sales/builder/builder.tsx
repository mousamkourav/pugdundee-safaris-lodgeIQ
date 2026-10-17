"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees, fmtDate } from "@/lib/sales/format";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { PriceResult } from "@/lib/sales/pricing/types";
import { buildDays, planToTrip, routeKey, routeProblems } from "@/lib/sales/plan/planner";
import { chatTurn, greeting, initialFlags, type ChatFlags, type ChatMessage, type QuickReply } from "@/lib/sales/plan/chat";
import type { BuilderContext, Plan } from "@/lib/sales/plan/types";
import { saveItinerary } from "@/app/(dashboard)/sales/new/actions";
import { aiReadTrip } from "@/app/(dashboard)/sales/new/ai-actions";
import { ChatPanel } from "./chat-panel";
import { TripDetails, EMAIL_RE } from "./trip-details";
import { PlanStep } from "./plan-step";
import { FinalDraft } from "./final-draft";

const STEPS = ["Trip", "Plan & price", "Final draft"];
const OFFLINE = "Could not reach the server. Your work is kept on this computer; check the connection and try again.";

interface Stored {
  plan: Plan;
  flags: ChatFlags;
  messages: ChatMessage[];
  savedAt: number;
}

function Stepper({ step, canGo, go }: { step: number; canGo: (n: number) => boolean; go: (n: number) => void }) {
  return (
    <ol className={`${ui.card} flex items-center gap-2 overflow-x-auto px-3 py-2`}>
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
            <button type="button" disabled={!canGo(i)} onClick={() => go(i)} className="flex items-center gap-2 whitespace-nowrap text-sm disabled:cursor-not-allowed disabled:opacity-60">
              <span
                className={
                  "grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold " +
                  (done ? "border-olive-600 bg-olive-600 text-white" : active ? "border-olive-600 bg-white text-olive-600 ring-4 ring-olive-100" : "border-sand-300 bg-white text-sand-500")
                }
              >
                {done ? <Icon name="check" className="h-4 w-4" /> : i + 1}
              </span>
              <span className={active || done ? "font-semibold text-olive-800" : "text-sand-500"}>{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className={"h-px min-w-6 flex-1 " + (done ? "bg-olive-600" : "bg-sand-200")} />}
          </li>
        );
      })}
    </ol>
  );
}

function PriceBar({ plan, result, blockers }: { plan: Plan; result: PriceResult | null; blockers: string[] }) {
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0);
  const needed = (result?.missing ?? []).filter((m) => plan.manual_prices?.[m.key] === undefined).length;
  return (
    <div className={`${ui.card} space-y-2 p-3`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{needed ? "Total so far" : "Total"}</p>
          <p className="tabular font-display text-2xl font-semibold text-olive-800">{result && !blockers.length ? rupees(result.totals.grand) : "-"}</p>
          {result && !blockers.length && <p className="text-xs text-sand-500">{rupees(result.perPerson)} per person</p>}
        </div>
        <div className="text-right text-xs text-sand-500">
          {nights > 0 && <p>{nights} nights</p>}
          {result?.arrival && <p>{fmtDate(result.arrival)} - {fmtDate(result.departure)}</p>}
        </div>
      </div>
      {needed > 0 && !blockers.length && (
        <p className={`${ui.alertWarning} text-xs`}>
          {needed} price{needed === 1 ? "" : "s"} not in master data yet. The total leaves {needed === 1 ? "it" : "them"} out until typed in on Plan & price.
        </p>
      )}
      {blockers.length > 0 && (
        <ul className={`${ui.alertWarning} list-disc space-y-0.5 pl-5 text-xs`}>
          {blockers.slice(0, 4).map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      )}
    </div>
  );
}

export function Builder({
  ctx,
  initial,
  queryId,
  queryNo = null,
  today,
  aiAvailable = false,
  startStep = 0,
  queryStatus = null,
}: {
  ctx: BuilderContext;
  initial: Plan;
  queryId: string | null;
  queryNo?: string | null;
  today: string;
  aiAvailable?: boolean;
  startStep?: number;
  queryStatus?: string | null;
}) {
  const router = useRouter();
  const storageKey = `lq-itinerary-draft:${queryId ?? "new"}`;

  const [plan, setPlanState] = useState<Plan>(initial);
  const [flags, setFlags] = useState<ChatFlags>(() => initialFlags(initial));
  const [messages, setMessages] = useState<ChatMessage[]>(() => [greeting(initial, queryNo)]);
  const [step, setStep] = useState(initial.days.length ? startStep : 0);
  const [builtKey, setBuiltKey] = useState(initial.days.length ? routeKey(initial) : "");
  const [daysEdited, setDaysEdited] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [restore, setRestore] = useState<Stored | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveProblems, setSaveProblems] = useState<string[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [currentId, setCurrentId] = useState<string | null>(queryId);
  const [currentStatus, setCurrentStatus] = useState<string | null>(queryStatus);
  const [notice, setNotice] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  const setPlan = useCallback((u: (p: Plan) => Plan) => {
    setPlanState(u);
    setDirty(true);
  }, []);
  const markFlag = useCallback((k: keyof Omit<ChatFlags, "pending" | "nightsUnknown">) => setFlags((f) => ({ ...f, [k]: true })), []);

  // ---- keep the day plan in step with the route
  const problems = useMemo(() => routeProblems(plan, ctx), [plan, ctx]);
  const key = routeKey(plan);
  const stale = plan.days.length > 0 && key !== builtKey;
  useEffect(() => {
    if (key === builtKey) return;
    if (problems.length || !plan.stops.length) {
      if (plan.days.length) setPlanState((p) => ({ ...p, days: [] }));
      setBuiltKey(key);
    } else if (!daysEdited || !plan.days.length) {
      setPlanState((p) => ({ ...p, days: buildDays(p, ctx) }));
      setBuiltKey(key);
    }
    // When days were edited by hand, wait for the user to choose (banner below).
  }, [key, builtKey, problems.length, plan.stops.length, plan.days.length, daysEdited, ctx]);

  const result = useMemo<PriceResult | null>(() => {
    if (!plan.days.length || problems.length || stale) return null;
    try {
      return priceTrip(planToTrip(plan, today), ctx.pricing);
    } catch {
      return null;
    }
  }, [plan, problems, stale, ctx, today]);
  const blockers = stale ? ["The route changed. Update the day plan first."] : [...problems, ...(result?.errors ?? [])];
  const ready = !!result && !blockers.length;
  const pricesNeeded = (result?.missing ?? []).filter((m) => plan.manual_prices?.[m.key] === undefined);
  const canDraft = currentStatus === null || currentStatus === "draft";

  // ---- autosave on this computer, and offer to restore after a crash or a closed tab
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as Stored;
      if (stored?.plan && JSON.stringify(stored.plan) !== JSON.stringify(initial)) setRestore(stored);
    } catch {
      /* storage unavailable or corrupt: ignore */
    }
  }, [storageKey, initial]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ plan, flags, messages: messages.slice(-30), savedAt: Date.now() } satisfies Stored));
      } catch {
        /* storage full or blocked: autosave is a convenience only */
      }
    }, 700);
    return () => clearTimeout(t);
  }, [plan, flags, messages, dirty, storageKey]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function clearStored() {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }

  // ---- navigation
  const canGo = (n: number) => n === 0 || (n <= 2 && ready);
  function go(n: number) {
    if (!canGo(n)) return;
    setStep(n);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- chat
  async function send(text: string) {
    setMessages((m) => [...m, { role: "user", text }]);
    setChatBusy(true);
    try {
      let r = chatTurn(plan, flags, text, ctx, today);
      // Ask the AI when the reader missed the important parts, not only when it
      // understood nothing: e.g. it caught "2 adults" but not the parks or the date.
      const missedParks = !r.plan.stops.length && /\d|night|park|lodge|safari|trip|stay/i.test(text);
      const missedDate = flags.pending === "date" && !r.flags.dateSet;
      if ((!r.understood || missedParks || missedDate) && aiAvailable && text.trim().length > 8) {
        try {
          const ai = await aiReadTrip(text);
          if (ai.parsed) {
            const r2 = chatTurn(plan, flags, text, ctx, today, ai.parsed);
            if (r2.understood) r = { ...r2, reply: { ...r2.reply, warnings: [...(r2.reply.warnings ?? []), "Read with AI help. Please check the details."] } };
          } else if (ai.error) {
            r = { ...r, reply: { ...r.reply, warnings: [...(r.reply.warnings ?? []), ai.error] } };
          }
        } catch {
          r = { ...r, reply: { ...r.reply, warnings: [...(r.reply.warnings ?? []), "AI help is not reachable right now."] } };
        }
      }
      if (r.routeChanged && daysEdited) {
        r = { ...r, reply: { ...r.reply, warnings: [...(r.reply.warnings ?? []), "The route changed, so the day texts were rewritten."] } };
      }
      setPlan(() => r.plan);
      setFlags(r.flags);
      if (r.routeChanged) {
        setBuiltKey(routeKey(r.plan));
        setDaysEdited(false);
      }
      setMessages((m) => [...m, r.reply]);
      if (r.reply.action === "review") go(1);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Something went wrong while reading that. Please try again, or use the form on the right." }]);
    } finally {
      setChatBusy(false);
    }
  }

  function quick(q: QuickReply) {
    if (q.action === "review") {
      if (ready) go(1);
      else setMessages((m) => [...m, { role: "assistant", text: "The plan is not ready yet.", warnings: blockers }]);
    } else if (q.text) void send(q.text);
  }

  // ---- save
  function save(mode: "draft" | "final") {
    setSaveError(null);
    setSaveProblems([]);
    setNameError(null);
    setNotice(null);
    if (mode === "final") {
      if (!plan.guest.name.trim()) {
        setNameError("Enter the guest's name to save.");
        go(2);
        return;
      }
      if (pricesNeeded.length) {
        setSaveError(`${pricesNeeded.length} price${pricesNeeded.length === 1 ? " is" : "s are"} still needed (Plan & price step). Fill ${pricesNeeded.length === 1 ? "it" : "them"} in, or save a draft for now.`);
        return;
      }
      if (plan.guest.email && !EMAIL_RE.test(plan.guest.email)) {
        setSaveError("The guest's email address does not look right. Fix it on the Trip step.");
        return;
      }
      if (plan.adjustment && !plan.adjustment.reason.trim()) {
        setSaveError("The manual adjustment needs a reason (Plan & price step).");
        return;
      }
    } else if (!plan.stops.length && !plan.guest.name.trim()) {
      setSaveError("Add at least the guest name or a park before saving a draft.");
      return;
    }
    startSave(async () => {
      try {
        const res = await saveItinerary(JSON.stringify(plan), currentId, mode);
        if (res.error) setSaveError(res.error);
        else if (res.problems?.length) setSaveProblems(res.problems);
        else if (res.id) {
          clearStored();
          setDirty(false);
          if (mode === "final") {
            router.push(`/sales/queries/${res.id}`);
            router.refresh();
          } else {
            // Stay here and keep working; later saves update the same draft.
            setCurrentId(res.id);
            setCurrentStatus("draft");
            window.history.replaceState(null, "", `/sales/new?from=${res.id}`);
            setNotice(`Draft saved at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}. Find it under Queries > Draft.`);
          }
        }
      } catch {
        setSaveError(OFFLINE);
      }
    });
  }

  // =====================================================================
  return (
    <div ref={topRef} className="scroll-mt-24">
      {restore && (
        <div className={`${ui.alertWarning} mb-4 flex flex-wrap items-center justify-between gap-3`}>
          <span>You have unsaved work from {new Date(restore.savedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. Restore it?</span>
          <span className="flex gap-2">
            <button
              type="button"
              className={`${ui.btnPrimary} ${ui.btnSm}`}
              onClick={() => {
                setPlanState(restore.plan);
                setFlags(restore.flags ?? initialFlags(restore.plan));
                setMessages(restore.messages?.length ? restore.messages : [greeting(restore.plan, queryNo)]);
                setBuiltKey(routeKey(restore.plan));
                setDirty(true);
                setRestore(null);
              }}
            >
              Restore
            </button>
            <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => { clearStored(); setRestore(null); }}>
              Discard
            </button>
          </span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <Stepper step={step} canGo={canGo} go={go} />
        </div>
        {canDraft && (
          <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={saving} onClick={() => save("draft")}>
            <Icon name="fileText" className="h-4 w-4" />
            {saving ? "Saving..." : "Save draft"}
          </button>
        )}
      </div>
      {notice && <p className={`${ui.alertSuccess} mb-3`}>{notice}</p>}
      {saveError && step !== 2 && <p className={`${ui.alertError} mb-3`}>{saveError}</p>}

      {stale && (
        <div className={`${ui.alertWarning} mb-4 flex flex-wrap items-center justify-between gap-3`}>
          <span>The route changed after you edited the day texts. Update the day plan to match? This rewrites the day texts.</span>
          <button
            type="button"
            className={`${ui.btnPrimary} ${ui.btnSm}`}
            onClick={() => {
              setPlanState((p) => ({ ...p, days: buildDays(p, ctx) }));
              setBuiltKey(key);
              setDaysEdited(false);
              setDirty(true);
            }}
          >
            Update day plan
          </button>
        </div>
      )}

      {step === 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <ChatPanel messages={messages} busy={chatBusy} onSend={send} onQuick={quick} aiAvailable={aiAvailable} />
            <div className="flex justify-end">
              <button type="button" className={ui.btnPrimary} disabled={!ready} onClick={() => go(1)} title={ready ? "" : blockers[0] ?? "Add the trip details first"}>
                Review the plan
                <Icon name="chevronLeft" className="h-4 w-4 rotate-180" />
              </button>
            </div>
          </div>
          <div className="space-y-4">
            <PriceBar plan={plan} result={result} blockers={plan.stops.length ? blockers : []} />
            <TripDetails plan={plan} setPlan={setPlan} ctx={ctx} today={today} markFlag={markFlag} />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <PlanStep plan={plan} setPlan={setPlan} ctx={ctx} result={result} />
          <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand-200 bg-white/95 px-3 py-2 shadow-card backdrop-blur">
            <div className="text-sm">
              <span className="eyebrow mr-2">{pricesNeeded.length ? "Total so far" : "Total"}</span>
              <span className="tabular font-display text-lg font-semibold text-olive-800">{result ? rupees(result.totals.grand) : "-"}</span>
              {result && <span className="ml-2 text-xs text-sand-500">{rupees(result.perPerson)} per person</span>}
              {pricesNeeded.length > 0 && <span className="ml-2 text-xs font-medium text-warning">{pricesNeeded.length} price{pricesNeeded.length === 1 ? "" : "s"} needed</span>}
            </div>
            <div className="flex gap-2">
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => go(0)}>Back to trip</button>
              <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={!ready} onClick={() => go(2)}>Final draft</button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <FinalDraft plan={plan} setPlan={setPlan} ctx={ctx} result={result} onDayEdited={() => setDaysEdited(true)} nameError={nameError} />
          <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
            <PriceBar plan={plan} result={result} blockers={blockers} />
            {saveError && <p className={ui.alertError}>{saveError}</p>}
            {saveProblems.length > 0 && (
              <div className={ui.alertError}>
                <p className="font-semibold">Fix these before saving:</p>
                <ul className="mt-1 list-disc pl-5">{saveProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
              </div>
            )}
            {pricesNeeded.length > 0 && (
              <p className={`${ui.alertWarning} text-xs`}>
                {pricesNeeded.length} price{pricesNeeded.length === 1 ? " is" : "s are"} still needed before this can go to the guest.{" "}
                <button type="button" className="font-semibold underline" onClick={() => go(1)}>Enter prices</button>
              </p>
            )}
            <button type="button" className={`${ui.btnPrimary} w-full`} disabled={saving || !ready || pricesNeeded.length > 0} onClick={() => save("final")}>
              {saving ? "Saving..." : currentStatus && currentStatus !== "draft" ? "Save as new version" : "Save and get the client link"}
            </button>
            {canDraft && (
              <button type="button" className={`${ui.btnSecondary} w-full`} disabled={saving} onClick={() => save("draft")}>
                Save draft, finish later
              </button>
            )}
            <button type="button" className={`${ui.btnSecondary} w-full`} onClick={() => go(1)}>Back to plan & price</button>
            <p className="text-xs text-sand-500">The client link is created when you save for the guest. Drafts are never shown to guests. Earlier versions are kept.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
