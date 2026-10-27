"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { paxText } from "@/lib/sales/pricing/pax";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees, fmtDate } from "@/lib/sales/format";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { PriceResult } from "@/lib/sales/pricing/types";
import { buildDays, planToTrip, routeKey, routeProblems } from "@/lib/sales/plan/planner";
import { chatTurn, greeting, initialFlags, nextQuestion, type ChatFlags, type ChatMessage, type QuickReply } from "@/lib/sales/plan/chat";
import { closureFor } from "@/lib/sales/pricing/engine";
import type { BuilderContext, Plan } from "@/lib/sales/plan/types";
import { saveItinerary } from "@/app/(dashboard)/sales/new/actions";
import { aiUnderstand } from "@/app/(dashboard)/sales/new/ai-actions";
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
  const nights = plan.stops.reduce((t, s) => t + s.nights, 0) + (plan.city_stays ?? []).reduce((t, c) => t + c.nights, 0); // lodges + city nights
  const needed = (result?.missing ?? []).filter((m) => plan.manual_prices?.[m.key] === undefined).length;
  return (
    <div className={`${ui.card} space-y-2 p-3`}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{needed ? "Total so far" : "Total"}</p>
          <p className="tabular font-display text-2xl font-semibold text-olive-800">{result && !blockers.length ? rupees(result.totals.grand) : "-"}</p>
          {result && !blockers.length && <p className="text-xs text-sand-500">{paxText(result.perPerson, result.split, rupees)}</p>}
        </div>
        <div className="text-right text-xs text-sand-500">
          {nights > 0 && <p>{nights} nights</p>}
          {plan.dateless ? <p>Dates not fixed</p> : result?.arrival && <p>{fmtDate(result.arrival)} - {fmtDate(result.departure)}</p>}
        </div>
      </div>
      {plan.stops.length > 0 && !plan.guest.country && (
        <p className={`${ui.alertWarning} text-xs`}>
          Nationality not chosen, so safari rates for foreign nationals are used. Choose the guest&apos;s country under Guest.
        </p>
      )}
      {needed > 0 && !blockers.length && (
        <p className={`${ui.alertWarning} text-xs`}>
          {needed} price{needed === 1 ? "" : "s"} not in master data yet. The total leaves {needed === 1 ? "it" : "them"} out until typed in on Plan & price.
        </p>
      )}
      {blockers.length > 0 && <p className="text-xs font-medium text-error">Not priced yet: see Before you continue, above.</p>}
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
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const first = [greeting(initial, queryNo)];
    if (!initial.stops.length) return first;
    // Opening a saved draft or quote: say where it stands and what to do next.
    try {
      const st = nextQuestion(initial, initialFlags(initial), ctx, today);
      return [...first, { role: "assistant" as const, text: st.text, warnings: st.warnings, quick: st.quick }];
    } catch {
      return first;
    }
  });
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
  const [leaveTo, setLeaveTo] = useState<string | null>(null); // where the user tried to go with unsaved work
  const dirtyRef = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const setPlan = useCallback((u: (p: Plan) => Plan) => {
    setPlanState(u);
    setDirty(true);
  }, []);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
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

  // Ask before leaving with unsaved work: links anywhere on the page (sidebar,
  // breadcrumbs) and the browser back button. Closing the tab is covered above.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setLeaveTo(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    window.history.pushState({ lqGuard: true }, "", window.location.href);
    const onPop = () => {
      if (!dirtyRef.current) return;
      window.history.pushState({ lqGuard: true }, "", window.location.href);
      setLeaveTo("__back__");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [dirty]);

  function leave(to: string) {
    dirtyRef.current = false;
    setDirty(false);
    setLeaveTo(null);
    if (to === "__back__") window.history.go(-2);
    else router.push(to);
  }

  // Remove safaris that fall on a closed time (e.g. Pench core on Wednesday afternoon).
  function removeClosedSafaris() {
    setPlan((p) => ({
      ...p,
      days: p.days.map((d) => (d.park_id ? { ...d, safaris: d.safaris.filter((s) => !closureFor(ctx.pricing, d.park_id!, s.zone, s.session, d.date)) } : d)),
    }));
  }

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
      // With the AI assistant on, Gemini reads every message first (with the conversation
      // and the trip so far); the built-in reader fills gaps and takes over if the AI is
      // unavailable. Short replies to the assistant's own questions ("cottage", "same",
      // "3") are handled by the built-in reader alone: instant, and they save AI quota.
      const shortAnswer = !!flags.pending && flags.pending !== "parks" && text.trim().length <= 30;
      if (aiAvailable && !shortAnswer && text.trim().length > 3) {
        try {
          const history = messages.filter((m) => m.text).map((m) => ({ role: m.role, text: m.text }));
          // never wait longer than 35 s: then the built-in reader's answer is shown
          const ai = await Promise.race([
            aiUnderstand({ message: text, history, planJson: JSON.stringify(plan) }),
            new Promise<{ parsed?: undefined; error: string }>((ok) => setTimeout(() => ok({ error: "The AI took too long; the built-in reader was used." }), 35_000)),
          ]);
          if (ai.parsed) r = chatTurn(plan, flags, text, ctx, today, ai.parsed, { aiPrimary: true });
          else if (ai.error) r = { ...r, reply: { ...r.reply, warnings: [...(r.reply.warnings ?? []), ai.error] } };
        } catch {
          r = { ...r, reply: { ...r.reply, warnings: [...(r.reply.warnings ?? []), "The AI is not reachable right now; the built-in reader was used."] } };
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
  function save(mode: "draft" | "final", after?: () => void) {
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
        // the first enquiry typed in this session teaches the AI assistant once the quote is saved
        const enquiry = messages.find((m) => m.role === "user" && m.text.trim().length > 15)?.text;
        // everything typed in this session: the reader logs the words it could not place
        const typed = messages.filter((m) => m.role === "user").map((m) => m.text);
        const res = await saveItinerary(JSON.stringify(plan), currentId, mode, enquiry, typed);
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
            dirtyRef.current = false;
            after?.();
          }
        }
      } catch {
        setSaveError(OFFLINE);
      }
    });
  }

  // ---------------------------------------------------------------- bottom bar
  const nextLabel = step === 0 ? "Next: Plan & price" : step === 1 ? "Next: Final draft" : currentStatus && currentStatus !== "draft" ? "Save as new version" : "Save and get the client link";
  const nextBlockedBy =
    step < 2
      ? !plan.stops.length
        ? "Add at least one park (tell the assistant, or use Route on the right)."
        : !ready
          ? blockers[0] ?? "The plan is not ready yet."
          : null
      : !ready
        ? blockers[0] ?? "The plan is not ready yet."
        : pricesNeeded.length
          ? `${pricesNeeded.length} price${pricesNeeded.length === 1 ? " is" : "s are"} still needed on Plan & price.`
          : null;
  const onNext = () => {
    if (nextBlockedBy) return;
    if (step < 2) go(step + 1);
    else save("final");
  };
  const closedSafaris = result?.errors.some((e) => e.includes("park closed")) ?? false;

  // =====================================================================
  return (
    <div ref={topRef} className="scroll-mt-24 pb-24">
      {restore && (
        <div className={`${ui.alertWarning} mb-3 flex flex-wrap items-center justify-between gap-3`}>
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

      {/* step bar stays visible while scrolling */}
      <div className="sticky top-16 z-20 -mx-4 mb-3 bg-sand-50/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <Stepper step={step} canGo={canGo} go={go} />
      </div>
      {notice && <p className={`${ui.alertSuccess} mb-3`}>{notice}</p>}
      {saveError && <p className={`${ui.alertError} mb-3`}>{saveError}</p>}
      {saveProblems.length > 0 && (
        <div className={`${ui.alertError} mb-3`}>
          <p className="font-semibold">Fix these before saving:</p>
          <ul className="mt-1 list-disc pl-5">{saveProblems.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}

      {/* what stops the next step, with a fix where possible */}
      {step < 2 && plan.stops.length > 0 && blockers.length > 0 && (
        <div className="mb-3 rounded-xl border border-error-border bg-error-bg p-3 text-sm text-error">
          <p className="font-semibold">Before you continue</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {closedSafaris && (
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={removeClosedSafaris}>
                Remove the safaris on closed times
              </button>
            )}
            {stale && (
              <button
                type="button"
                className={`${ui.btnSecondary} ${ui.btnSm}`}
                onClick={() => {
                  setPlanState((p) => ({ ...p, days: buildDays(p, ctx) }));
                  setBuiltKey(key);
                  setDaysEdited(false);
                  setDirty(true);
                }}
              >
                Update the day plan
              </button>
            )}
            {problems.length > 0 && step !== 0 && (
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => go(0)}>
                Edit the route
              </button>
            )}
          </div>
        </div>
      )}

      {step === 0 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          <ChatPanel messages={messages} busy={chatBusy} onSend={send} onQuick={quick} aiAvailable={aiAvailable} />
          <div className="space-y-3">
            <PriceBar plan={plan} result={result} blockers={plan.stops.length ? blockers : []} />
            <TripDetails plan={plan} setPlan={setPlan} ctx={ctx} today={today} markFlag={markFlag} />
          </div>
        </div>
      )}

      {step === 1 && <PlanStep plan={plan} setPlan={setPlan} ctx={ctx} result={result} />}

      {step === 2 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <FinalDraft plan={plan} setPlan={setPlan} ctx={ctx} result={result} onDayEdited={() => setDaysEdited(true)} nameError={nameError} />
          <aside className="space-y-3 lg:sticky lg:top-36 lg:self-start">
            <PriceBar plan={plan} result={result} blockers={blockers} />
            <p className="text-xs text-sand-500">
              The client link is created when you save for the guest. Drafts are never shown to guests, and earlier versions are kept.
            </p>
          </aside>
        </div>
      )}

      {/* ---------------- one bar for every step: Back, Save draft, Next ---------------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-sand-200 bg-white/95 backdrop-blur lg:left-[280px] print:hidden">
        <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-10">
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className="eyebrow mr-2">{pricesNeeded.length ? "Total so far" : "Total"}</span>
              <span className="tabular font-display text-lg font-semibold text-olive-800">{result && !blockers.length ? rupees(result.totals.grand) : "-"}</span>
              {result && !blockers.length && <span className="ml-2 text-xs text-sand-500">{paxText(result.perPerson, result.split, rupees)}</span>}
            </p>
            {nextBlockedBy ? (
              <p className="truncate text-xs font-medium text-error" title={nextBlockedBy}>{nextBlockedBy}</p>
            ) : pricesNeeded.length > 0 ? (
              <p className="truncate text-xs font-medium text-warning">{pricesNeeded.length} price{pricesNeeded.length === 1 ? "" : "s"} still to enter on Plan &amp; price</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {step > 0 && (
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => go(step - 1)}>
                <Icon name="chevronLeft" className="h-4 w-4" />
                Back
              </button>
            )}
            {canDraft && (
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={saving} onClick={() => save("draft")}>
                <Icon name="fileText" className="h-4 w-4" />
                {saving ? "Saving..." : "Save draft"}
              </button>
            )}
            <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={saving || !!nextBlockedBy} onClick={onNext} title={nextBlockedBy ?? ""}>
              {saving && step === 2 ? "Saving..." : nextLabel}
              {step < 2 && <Icon name="chevronLeft" className="h-4 w-4 rotate-180" />}
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- leaving with unsaved work ---------------- */}
      {leaveTo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-olive-800/35 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Unsaved changes">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-overlay">
            <h2 className="text-lg">Leave without saving?</h2>
            <p className="mt-1 text-sm text-sand-600">This itinerary has changes that are not saved yet.</p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
              {canDraft && (
                <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={saving} onClick={() => { const to = leaveTo; save("draft", () => leave(to)); }}>
                  {saving ? "Saving..." : "Save draft and leave"}
                </button>
              )}
              <button type="button" className={`${ui.btnDangerOutline} ${ui.btnSm}`} onClick={() => { clearStored(); leave(leaveTo); }}>
                Leave without saving
              </button>
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setLeaveTo(null)}>
                Stay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
