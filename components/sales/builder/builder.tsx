"use client";

import { GroupDetails } from "@/components/sales/group/group-details";
import { GroupCosting } from "@/components/sales/group/group-costing";
import { GroupPrices } from "@/components/sales/group/group-prices";
import { defaultGroup, priceGroup, rowFor, toSaved } from "@/lib/sales/group/costing";
import { costSheet } from "@/lib/sales/group/sheet";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { paxText } from "@/lib/sales/pricing/pax";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees, fmtDate } from "@/lib/sales/format";
import { priceTrip } from "@/lib/sales/pricing/engine";
import type { PriceResult } from "@/lib/sales/pricing/types";
import { buildDays, planToTrip, routeKey, routeProblems } from "@/lib/sales/plan/planner";
import { chatTurn, greeting, initialFlags, nextQuestion, type ChatFlags, type ChatMessage, type ChatResult, type QuickReply } from "@/lib/sales/plan/chat";
import { closureFor } from "@/lib/sales/pricing/engine";
import type { BuilderContext, Plan } from "@/lib/sales/plan/types";
import { learnFromConfirmation, saveItinerary } from "@/app/(dashboard)/sales/new/actions";
import { assistReading, type AssistResult } from "@/app/(dashboard)/sales/new/ai-actions";
import { aiToParsed } from "@/lib/sales/plan/ai";
import { isShortAnswer } from "@/lib/sales/plan/reading";
import { canUpdateInPlace, defaultVersionMode, type VersionMode } from "@/lib/sales/versions";
import { isConfirmed, markConfirmed } from "@/lib/sales/plan/confirm";
import { quoteChecks } from "@/lib/sales/plan/checks";
import { ChatPanel } from "./chat-panel";
import { TripDetails, EMAIL_RE } from "./trip-details";
import { PlanStep } from "./plan-step";
import { FinalDraft } from "./final-draft";
import { ConfirmStep } from "./confirm-step";
import { TripForm } from "./trip-form";

// Trip -> Confirm (the trip in plain words, corrected and confirmed) -> Plan & price -> Final draft
const STEPS = ["Trip", "Confirm", "Plan & price", "Final draft"];
// A small spinner for a button that waits for the server.
const Spinner = () => <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
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
  isAdmin = false,
  startStep = 0,
  queryStatus = null,
  group = false,
}: {
  ctx: BuilderContext;
  initial: Plan;
  queryId: string | null;
  queryNo?: string | null;
  today: string;
  aiAvailable?: boolean;
  isAdmin?: boolean; // Sales admin: a typed rate is saved straight into Master data
  startStep?: number;
  queryStatus?: string | null;
  group?: boolean; // a group quote (Sales > Group quotes): group details, costing sheet and price ladder
}) {
  const router = useRouter();
  const storageKey = `lq-itinerary-draft:${group ? "group:" : ""}${queryId ?? "new"}`;
  // a group quote starts with the group's details (6 paying guests + 1 tour leader)
  if (group && !initial.group) initial = { ...initial, group: defaultGroup(), guest: { ...initial.guest, adults: initial.stops.length ? initial.guest.adults : 6, rooms: initial.stops.length ? initial.guest.rooms : 3 } };

  // a quote saved before the Confirm step existed was checked when it was made: confirmed as it is
  const [plan, setPlanState] = useState<Plan>(() => (initial.days.length && !initial.confirmed ? markConfirmed(initial, new Date().toISOString()) : initial));
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
  // Plan & price and Final draft open only for a confirmed route
  const [step, setStep] = useState(initial.days.length ? (startStep >= 2 && initial.confirmed && !isConfirmed(initial) ? 1 : startStep) : 0);
  // the Trip step: the assistant (chat) or the form
  const [tripMode, setTripMode] = useState<"chat" | "form">("chat");
  // corrections made on the Confirm step since it was last confirmed (the reader learns from them)
  const [confirmEdited, setConfirmEdited] = useState(false);
  const [builtKey, setBuiltKey] = useState(initial.days.length ? routeKey(initial) : "");
  const [daysEdited, setDaysEdited] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  // the enquiry typed into an empty trip: saved with the quote as the reading memory
  const [firstEnquiry, setFirstEnquiry] = useState<string | null>(null);
  const [versionAsk, setVersionAsk] = useState(false);
  const [versionMode, setVersionMode] = useState<VersionMode>("new");
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

  // Priced from a deferred copy of the plan: a keystroke shows at once, and the total follows
  // as soon as the browser is free (React skips the pricing of plans already typed over).
  const pricedPlan = useDeferredValue(plan);
  const result = useMemo<PriceResult | null>(() => {
    if (!pricedPlan.days.length || problems.length || stale) return null;
    try {
      return priceTrip(planToTrip(pricedPlan, today), ctx.pricing);
    } catch {
      return null;
    }
  }, [pricedPlan, problems, stale, ctx, today]);
  const blockers = stale ? ["The route changed. Update the day plan first."] : [...problems, ...(result?.errors ?? [])];
  const ready = !!result && !blockers.length;
  const pricesNeeded = (result?.missing ?? []).filter((m) => plan.manual_prices?.[m.key] === undefined);
  const confirmed = isConfirmed(plan);
  // the route can be shown in plain words once it is complete and its days are built
  const routeReady = plan.stops.length > 0 && !problems.length && plan.days.length > 0 && !stale;
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
  const canGo = (n: number) => n === 0 || (n === 1 && routeReady) || (n <= 3 && ready && confirmed);
  function go(n: number) {
    if (!canGo(n)) return;
    setStep(n);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- chat
  // The trip as it is now: an answer that comes back from the server applies to it (a field
  // changed by hand while the AI was reading is kept).
  const planRef = useRef(plan);
  const flagsRef = useRef(flags);
  useEffect(() => {
    planRef.current = plan;
    flagsRef.current = flags;
  }, [plan, flags]);
  // Shows a chat result.
  function apply(res: ChatResult): ChatResult {
    const r = res.routeChanged && daysEdited ? { ...res, reply: { ...res.reply, warnings: [...(res.reply.warnings ?? []), "The route changed, so the day texts were rewritten."] } } : res;
    setPlan(() => r.plan);
    setFlags(r.flags);
    if (r.routeChanged) {
      setBuiltKey(routeKey(r.plan));
      setDaysEdited(false);
    }
    setMessages((m) => [...m, r.reply]);
    if (r.reply.action === "review") setStep(1); // "check the trip": the Confirm step
    return r;
  }

  async function send(text: string) {
    setMessages((m) => [...m, { role: "user", text }]);
    setChatBusy(true);
    try {
      // One reading, AI first (lib/sales/plan/reading.ts): the server tries the memory of saved
      // quotes (a new trip only), then the AI, whose every value must quote the message
      // (evidence.ts). The built-in reader fills what the AI left empty, and reads alone when
      // the AI is off, fails or takes too long. A short reply to the assistant's own question
      // ("cottage", "same", "7 and 12") is read here at once and never sent.
      if (!plan.stops.length && text.trim().length >= 15) setFirstEnquiry((e) => e ?? text);
      if (isShortAnswer(text, flags.pending) || text.trim().length <= 3) {
        apply(chatTurn(plan, flags, text, ctx, today));
        return;
      }
      let more: AssistResult;
      try {
        const history = messages.filter((m) => m.text).map((m) => ({ role: m.role, text: m.text }));
        // never wait longer than 50 s: then the built-in reader reads
        more = await Promise.race([
          assistReading({ message: text, history, planJson: JSON.stringify(plan) }),
          new Promise<AssistResult>((ok) => setTimeout(() => ok({ source: "reader", error: "The AI took too long; the built-in reader was used." }), 50_000)),
        ]);
      } catch {
        more = { source: "reader", error: "The AI could not be reached; the built-in reader was used." };
      }
      const now = planRef.current;
      const nowFlags = flagsRef.current;
      const r =
        (more.source === "memory" || more.source === "ai") && more.reading
          ? chatTurn(now, nowFlags, text, ctx, today, { parsed: aiToParsed(more.reading, ctx), source: more.source })
          : chatTurn(now, nowFlags, text, ctx, today);
      // said quietly under the reply: the assistant keeps working without the AI
      const note =
        more.source === "reader" && aiAvailable && more.error
          ? "built-in reader (AI not available)"
          : more.source === "ai" && more.dropped
            ? `${r.reply.source}; ${more.dropped} AI value${more.dropped === 1 ? "" : "s"} not said in the message left out`
            : r.reply.source;
      apply({ ...r, reply: { ...r.reply, source: note } });
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Something went wrong while reading that. Please try again, or use the form on the right." }]);
    } finally {
      setChatBusy(false);
    }
  }

  function quick(q: QuickReply) {
    if (q.action === "review") {
      if (routeReady) go(1);
      else setMessages((m) => [...m, { role: "assistant", text: "The plan is not ready yet.", warnings: blockers }]);
    } else if (q.text) void send(q.text);
  }

  // a group quote: its prices by group size, as the tour operator sees them (Final draft)
  const groupSaved = useMemo(() => {
    if (!group || !plan.group || step !== 3) return null;
    const g = plan.group;
    const rows = g.rows.length ? g.rows : [rowFor(g, g.paying, g.tls)];
    return toSaved(priceGroup(costSheet(plan, ctx, today, g).days, { ...g, rows }), { ...g, rows });
  }, [group, plan, ctx, today, step]);

  // ---- save
  function save(mode: "draft" | "final", after?: () => void, versionMode: VersionMode = "new") {
    setSaveError(null);
    setSaveProblems([]);
    setNameError(null);
    setNotice(null);
    if (mode === "final") {
      if (!plan.guest.name.trim()) {
        setNameError("Enter the guest's name to save.");
        go(3);
        return;
      }
      // the hard checks (lib/sales/plan/checks.ts); the server runs them again
      const checks = quoteChecks(plan, ctx, result);
      if (checks.length) {
        setSaveProblems(checks);
        if (!confirmed) setStep(1);
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
      if (group && !(plan.group?.fx && plan.group.fx > 0)) {
        setSaveError("Type the US dollar rate (Plan & price, Price by group size).");
        go(2);
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
        // the enquiry typed into the empty trip is remembered with the quote (Reading memory);
        // a change typed into a saved quote ("make Pench 2 nights") is not an enquiry
        const enquiry = firstEnquiry ?? (initial.stops.length ? undefined : messages.find((m) => m.role === "user" && m.text.trim().length >= 15)?.text);
        // everything typed in this session: the reader logs the words it could not place
        const typed = messages.filter((m) => m.role === "user").map((m) => m.text);
        const res = await saveItinerary(JSON.stringify(plan), currentId, mode, enquiry, typed, versionMode, group ? "group" : undefined);
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
  // editing a quote that is not a draft: asked whether it is a new version or a correction
  const editingSaved = !!currentId && !!currentStatus && currentStatus !== "draft";
  const nextLabel = step === 0 ? "Next: Confirm the trip" : step === 1 ? "Correct, continue" : step === 2 ? "Next: Final draft" : editingSaved ? "Save changes" : "Save and get the client link";
  // the hard checks, shown on the last step before saving for the guest
  const finalChecks = step === 3 && ready ? quoteChecks(plan, ctx, result) : [];
  const nextBlockedBy =
    step === 0
      ? !plan.stops.length
        ? "Add at least one park (tell the assistant, use the form, or Route on the right)."
        : !routeReady
          ? blockers[0] ?? "The plan is not ready yet."
          : null
      : !ready
        ? blockers[0] ?? "The plan is not ready yet."
        : step === 3
          ? finalChecks[0] ?? null
          : null;
  // "Correct, continue": this route is confirmed; corrections made here teach the reader
  function confirmTrip() {
    if (!ready) return;
    const done = markConfirmed(plan, new Date().toISOString());
    setPlan(() => done);
    const enquiry = firstEnquiry ?? messages.find((m) => m.role === "user" && m.text.trim().length >= 15)?.text;
    if (confirmEdited && enquiry) {
      const typed = messages.filter((m) => m.role === "user").map((m) => m.text);
      void learnFromConfirmation(JSON.stringify(done), enquiry, typed).catch(() => undefined);
    }
    setConfirmEdited(false);
    setStep(2);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const onNext = () => {
    if (nextBlockedBy) return;
    if (step === 1) confirmTrip();
    else if (step < 3) go(step + 1);
    else if (editingSaved) {
      setVersionMode(canUpdateInPlace(currentStatus) ? defaultVersionMode(currentStatus) : "new");
      setVersionAsk(true);
    } else save("final");
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
      {step < 3 && plan.stops.length > 0 && blockers.length > 0 && (
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
          <div className="space-y-2">
            {/* describe the trip to the assistant, or build it with a form (no reading involved) */}
            <div className="flex gap-2" role="tablist" aria-label="How to build the trip">
              {([["chat", "Describe it (assistant)"], ["form", "Build with a form"]] as const).map(([m, label]) => (
                <button key={m} type="button" role="tab" aria-selected={tripMode === m} className={`${tripMode === m ? ui.btnPrimary : ui.btnSecondary} ${ui.btnSm}`} onClick={() => setTripMode(m)}>
                  {label}
                </button>
              ))}
            </div>
            {tripMode === "chat" ? (
              <ChatPanel messages={messages} busy={chatBusy} onSend={send} onQuick={quick} aiAvailable={aiAvailable} />
            ) : (
              <TripForm plan={plan} setPlan={setPlan} ctx={ctx} />
            )}
          </div>
          <div className="space-y-3">
            <PriceBar plan={plan} result={result} blockers={plan.stops.length ? blockers : []} />
            <TripDetails plan={plan} setPlan={setPlan} ctx={ctx} today={today} markFlag={markFlag} />
            {group && <GroupDetails plan={plan} setPlan={setPlan} />}
          </div>
        </div>
      )}

      {step === 1 && <ConfirmStep plan={plan} setPlan={setPlan} ctx={ctx} confirmed={confirmed} onConfirm={onNext} onEdited={() => setConfirmEdited(true)} />}

      {step === 2 && <PlanStep plan={plan} setPlan={setPlan} ctx={ctx} result={result} isAdmin={isAdmin} />}
      {step === 2 && group && <GroupCosting plan={plan} setPlan={setPlan} ctx={ctx} today={today} />}

      {step === 3 && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <FinalDraft plan={plan} setPlan={setPlan} ctx={ctx} result={result} onDayEdited={() => setDaysEdited(true)} nameError={nameError} />
          <aside className="space-y-3 lg:sticky lg:top-36 lg:self-start">
            {groupSaved ? (
              <div className={`${ui.card} p-4`}>
                <p className="mb-2 text-sm font-semibold text-olive-800">What the tour operator sees</p>
                <GroupPrices g={groupSaved} />
              </div>
            ) : (
              <PriceBar plan={plan} result={result} blockers={blockers} />
            )}
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
                {saving && <Spinner />}
                {saving ? "Saving..." : "Save draft"}
              </button>
            )}
            <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={saving || !!nextBlockedBy} onClick={onNext} title={nextBlockedBy ?? ""}>
              {saving && step === 3 && <Spinner />}
              {saving && step === 3 ? "Saving..." : nextLabel}
              {step < 3 && <Icon name="chevronLeft" className="h-4 w-4 rotate-180" />}
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- saving an edited quote: new version or a correction ---------------- */}
      {versionAsk && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-olive-800/35 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="How to save the changes">
          <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-overlay">
            <h2 className="text-lg">How should the changes be saved?</h2>
            <div className="space-y-2">
              {(
                [
                  ["new", "Save as a new version", "The current version and its client link are kept; the new version gets its own link."],
                  ["update", "Update the current version", "For a correction before sending: the same client link shows the change. Who changed it and when is recorded."],
                ] as const
              ).map(([value, title, help]) => {
                const locked = value === "update" && !canUpdateInPlace(currentStatus);
                return (
                  <label key={value} className={`flex gap-3 rounded-lg border p-3 text-sm ${versionMode === value ? "border-olive-600 bg-olive-50" : "border-sand-200"} ${locked ? "opacity-60" : "cursor-pointer"}`}>
                    <input type="radio" name="versionMode" className="mt-1" checked={versionMode === value} disabled={locked} onChange={() => setVersionMode(value)} />
                    <span>
                      <span className="block font-semibold text-olive-800">{title}</span>
                      <span className="block text-xs text-sand-500">{locked ? "Not for a booked or cancelled quote." : help}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setVersionAsk(false)} disabled={saving}>
                Cancel
              </button>
              <button
                type="button"
                className={`${ui.btnPrimary} ${ui.btnSm}`}
                disabled={saving}
                onClick={() => {
                  setVersionAsk(false);
                  save("final", undefined, versionMode);
                }}
              >
                {versionMode === "update" ? "Update the current version" : "Save as a new version"}
              </button>
            </div>
          </div>
        </div>
      )}

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
