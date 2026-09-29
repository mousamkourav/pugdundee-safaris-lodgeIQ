"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PhotoPicker, type PickedPhoto } from "@/components/photo-picker";
import type { LodgeLite } from "@/lib/lodges";
import { Icon } from "@/components/icons";
import {
  MAX_PHOTOS,
  TASK_PRIORITIES,
  PRIORITY_LABEL,
  newUuid,
  removeTaskPhotos,
  uploadTaskPhotos,
  tripDays,
  type NewTaskInput,
} from "@/lib/tasks";
import { createTrip } from "./trip-actions";

const INPUT =
  "w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-100";
const LABEL = "mb-1.5 block text-sm font-medium text-sand-800";

const CHIP_BASE =
  "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition sm:min-h-10";
const PRIORITY_CHIP: Record<string, { on: string; off: string }> = {
  low: {
    off: `${CHIP_BASE} border-sand-200 bg-sand-100 text-sand-700 hover:bg-sand-200`,
    on: `${CHIP_BASE} border-sand-500 bg-white font-semibold text-olive-800 shadow-card`,
  },
  medium: {
    off: `${CHIP_BASE} border-sand-200 bg-sand-100 text-sand-700 hover:bg-sand-200`,
    on: `${CHIP_BASE} border-gold-500 bg-gold-50 font-semibold text-gold-800 shadow-card`,
  },
  high: {
    off: `${CHIP_BASE} border-sand-200 bg-sand-100 text-sand-700 hover:bg-sand-200`,
    on: `${CHIP_BASE} border-error-border bg-error-bg font-semibold text-error shadow-card`,
  },
};

// One task being edited in Step 2 (before it is queued into the trip).
type Draft = {
  title: string;
  description: string;
  priority: string;
  due_date: string;
  photos: PickedPhoto[];
};

function emptyDraft(): Draft {
  return { title: "", description: "", priority: "medium", due_date: "", photos: [] };
}

// A task already queued in this session (kept until the whole trip is saved).
type Queued = {
  id: string;
  title: string;
  priority: string;
  due_date: string;
  description: string;
  photos: PickedPhoto[];
};

export function AssignTripForm({
  lodges,
  defaultLodge,
  authorityChips,
  onDone,
}: {
  lodges: LodgeLite[];
  defaultLodge: string;
  authorityChips?: string[];
  onDone?: () => void;
}) {
  const router = useRouter();

  // Step 1 - trip
  const [step, setStep] = useState<1 | 2>(1);
  const [lodgeId, setLodgeId] = useState(defaultLodge);
  const [authority, setAuthority] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [focus, setFocus] = useState("");

  // Step 2 - tasks
  const [queued, setQueued] = useState<Queued[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = busy !== null;

  const lodgeName = lodges.find((l) => l.id === lodgeId)?.name ?? "lodge";
  const days = useMemo(() => tripDays(startDate, endDate), [startDate, endDate]);

  function goToTasks() {
    setError(null);
    if (!lodgeId) return setError("Choose a lodge.");
    if (startDate && endDate && endDate < startDate)
      return setError("End date cannot be before the start date.");
    setStep(2);
  }

  function addDraftToQueue() {
    setError(null);
    if (!draft.title.trim()) return setError("Give the task a title.");
    setQueued((q) => [
      ...q,
      {
        id: newUuid(),
        title: draft.title.trim(),
        description: draft.description,
        priority: draft.priority,
        due_date: draft.due_date,
        photos: draft.photos,
      },
    ]);
    setDraft(emptyDraft());
  }

  function removeQueued(id: string) {
    setQueued((q) => {
      const hit = q.find((t) => t.id === id);
      hit?.photos.forEach((p) => URL.revokeObjectURL(p.preview));
      return q.filter((t) => t.id !== id);
    });
  }

  async function saveTrip() {
    setError(null);
    // Include the current draft if it has a title but wasn't added yet.
    let tasks = queued;
    if (draft.title.trim()) {
      tasks = [
        ...queued,
        {
          id: newUuid(),
          title: draft.title.trim(),
          description: draft.description,
          priority: draft.priority,
          due_date: draft.due_date,
          photos: draft.photos,
        },
      ];
    }
    if (tasks.length === 0) return setError("Add at least one task to the trip.");

    const supabase = createClient();
    const tripId = newUuid();
    const allUploaded: string[] = [];
    try {
      const payload: NewTaskInput[] = [];
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        let paths: string[] = [];
        if (t.photos.length) {
          setBusy(`Uploading photos for task ${i + 1} of ${tasks.length}...`);
          paths = await uploadTaskPhotos(
            supabase,
            lodgeId,
            t.id,
            "ref",
            t.photos.map((p) => p.blob)
          );
          allUploaded.push(...paths);
        }
        payload.push({
          id: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          due_date: t.due_date,
          photos: paths,
        });
      }

      setBusy(`Assigning ${tasks.length} task${tasks.length > 1 ? "s" : ""}...`);
      const res = await createTrip({
        id: tripId,
        lodge_id: lodgeId,
        authority: authority.trim() || undefined,
        focus: focus.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        tasks: payload,
      });
      if (!res.ok) {
        await removeTaskPhotos(supabase, allUploaded);
        setError(res.error);
        return;
      }
      // success - clean up previews and reset
      tasks.forEach((t) => t.photos.forEach((p) => URL.revokeObjectURL(p.preview)));
      setQueued([]);
      setDraft(emptyDraft());
      setStep(1);
      setAuthority("");
      setStartDate("");
      setEndDate("");
      setFocus("");
      router.refresh();
      onDone?.();
    } catch (err) {
      await removeTaskPhotos(supabase, allUploaded);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const totalCount = queued.length + (draft.title.trim() ? 1 : 0);

  return (
    <div className="space-y-5">
      {/* step indicator */}
      <div className="flex items-center gap-3 text-sm">
        <span className={"flex items-center gap-2 " + (step === 1 ? "text-olive-800 font-semibold" : "text-sand-500")}>
          <span className={"grid h-6 w-6 place-items-center rounded-full text-xs font-bold " + (step === 1 ? "bg-olive-600 text-white" : "bg-success-bg text-success")}>
            {step > 1 ? <Icon name="check" className="h-3.5 w-3.5" /> : "1"}
          </span>
          Trip details
        </span>
        <span className="h-px flex-1 bg-sand-200" />
        <span className={"flex items-center gap-2 " + (step === 2 ? "text-olive-800 font-semibold" : "text-sand-500")}>
          <span className={"grid h-6 w-6 place-items-center rounded-full text-xs font-bold " + (step === 2 ? "bg-olive-600 text-white" : "bg-sand-200 text-sand-600")}>
            2
          </span>
          Add tasks
        </span>
      </div>

      {error && (
        <p className="rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      {step === 1 ? (
        <div className="space-y-5">
          <div>
            <label className={LABEL}>Select lodge *</label>
            <select
              value={lodgeId}
              onChange={(e) => setLodgeId(e.target.value)}
              disabled={disabled}
              className={INPUT}
            >
              {lodges.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-sand-500">All tasks in this trip are linked to this lodge.</p>
          </div>

          <div>
            <label className={LABEL}>Visiting authority / inspection lead</label>
            <input
              value={authority}
              onChange={(e) => setAuthority(e.target.value)}
              disabled={disabled}
              maxLength={200}
              placeholder="e.g. Manav Khanduja (Managing Director)"
              className={INPUT}
            />
            {authorityChips && authorityChips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {authorityChips.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setAuthority(name)}
                    className="rounded-full border border-sand-200 bg-sand-100 px-2.5 py-1 text-xs font-medium text-sand-700 hover:bg-sand-200"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className={LABEL}>
              Visit dates
              {days > 0 && (
                <span className="ml-2 rounded-full bg-gold-50 px-2 py-0.5 text-xs font-semibold text-gold-800">
                  {days} day{days > 1 ? "s" : ""}
                </span>
              )}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1 block text-xs text-sand-500">Start date</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={disabled} className={INPUT} />
              </div>
              <div>
                <span className="mb-1 block text-xs text-sand-500">End date</span>
                <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} disabled={disabled} className={INPUT} />
              </div>
            </div>
          </div>

          <div>
            <label className={LABEL}>Inspection focus / notes</label>
            <textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              rows={3}
              maxLength={4000}
              disabled={disabled}
              placeholder="General scope of the visit (optional)."
              className={INPUT}
            />
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={goToTasks}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-olive-600 px-5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-olive-700"
            >
              Continue to add tasks
              <Icon name="arrowRight" className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* fixed trip header */}
          <div className="flex items-start gap-3 rounded-xl border border-sand-200 bg-sand-50 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-olive-600 text-white">
              <Icon name="mapPin" className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-olive-800">{lodgeName}</p>
              <p className="text-xs text-sand-500">
                {authority ? authority + " - " : ""}
                {startDate ? startDate : "dates not set"}
                {endDate && endDate !== startDate ? ` to ${endDate}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStep(1)}
              disabled={disabled}
              className="rounded-lg border border-sand-200 px-2.5 py-1 text-xs font-medium text-sand-700 hover:bg-sand-100"
            >
              Edit
            </button>
          </div>

          {/* queued tasks */}
          {queued.length > 0 && (
            <ul className="space-y-2">
              {queued.map((t, i) => (
                <li key={t.id} className="flex items-center gap-3 rounded-lg border border-sand-200 bg-white p-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-olive-100 text-xs font-bold text-olive-700">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-sand-800">{t.title}</span>
                  <span className="shrink-0 text-xs capitalize text-sand-500">{t.priority}</span>
                  <button
                    type="button"
                    onClick={() => removeQueued(t.id)}
                    disabled={disabled}
                    className="rounded-lg p-1.5 text-sand-500 hover:bg-error-bg hover:text-error"
                    aria-label="Remove task"
                  >
                    <Icon name="x" className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* draft task entry */}
          <div className="space-y-4 rounded-xl border border-sand-200 bg-white p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-olive-800">
              <Icon name="plus" className="h-4 w-4" />
              Task {queued.length + 1} in this trip
            </p>

            <div>
              <label className={LABEL}>Task title *</label>
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                disabled={disabled}
                maxLength={200}
                placeholder="e.g. Fix leaking tap in cottage 4"
                className={INPUT}
              />
            </div>

            <div>
              <label className={LABEL}>Instructions</label>
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                disabled={disabled}
                rows={3}
                maxLength={4000}
                placeholder="What needs doing and where."
                className={INPUT}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className={LABEL}>Priority</span>
                <div className="grid grid-cols-3 gap-2">
                  {TASK_PRIORITIES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setDraft({ ...draft, priority: p })}
                      disabled={disabled}
                      className={draft.priority === p ? PRIORITY_CHIP[p].on : PRIORITY_CHIP[p].off}
                    >
                      {p === "high" && <span className="h-1.5 w-1.5 rounded-full bg-error" />}
                      {PRIORITY_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={LABEL}>Due date</label>
                <input
                  type="date"
                  value={draft.due_date}
                  onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                  disabled={disabled}
                  className={INPUT}
                />
              </div>
            </div>

            <PhotoPicker
              photos={draft.photos}
              setPhotos={(p) =>
                setDraft((d) => ({ ...d, photos: typeof p === "function" ? p(d.photos) : p }))
              }
              max={MAX_PHOTOS}
              label="Reference photos"
              disabled={disabled}
            />

            <button
              type="button"
              onClick={addDraftToQueue}
              disabled={disabled}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-olive-600 px-3 py-1.5 text-sm font-semibold text-olive-700 hover:bg-olive-50"
            >
              <Icon name="plus" className="h-4 w-4" />
              Add another task
            </button>
          </div>

          {/* footer */}
          <div className="sticky bottom-0 -mx-5 -mb-5 space-y-2 border-t border-sand-200 bg-white px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6">
            <button
              type="button"
              onClick={saveTrip}
              disabled={disabled}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-olive-600 px-5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-olive-700 disabled:opacity-60"
            >
              <Icon name="send" className="h-4 w-4" />
              {busy ?? `Assign ${totalCount || ""} task${totalCount === 1 ? "" : "s"} to ${lodgeName}`}
            </button>
            <p className="text-center text-xs text-sand-500">
              Lodge managers are notified in-app as soon as the trip is assigned.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
