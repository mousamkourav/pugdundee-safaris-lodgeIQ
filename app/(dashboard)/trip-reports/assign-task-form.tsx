"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PhotoPicker, type PickedPhoto } from "@/components/photo-picker";
import type { LodgeLite } from "@/lib/lodges";
import {
  MAX_PHOTOS,
  TASK_PRIORITIES,
  PRIORITY_LABEL,
  newUuid,
  removeTaskPhotos,
  uploadTaskPhotos,
} from "@/lib/tasks";
import { Icon } from "@/components/icons";
import { createTask } from "./actions";

const INPUT =
  "w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-100";
const LABEL = "mb-1.5 block text-sm font-medium text-sand-800";

// Segmented priority control; the radio input is the peer that drives styling.
const CHIP_BASE =
  "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition peer-focus-visible:ring-3 peer-focus-visible:ring-gold-500/35 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 sm:min-h-10";
const PRIORITY_CHIP: Record<string, string> = {
  low: `${CHIP_BASE} border-sand-200 bg-sand-100 text-sand-700 hover:bg-sand-200 peer-checked:border-sand-500 peer-checked:bg-white peer-checked:font-semibold peer-checked:text-olive-800 peer-checked:shadow-card`,
  medium: `${CHIP_BASE} border-sand-200 bg-sand-100 text-sand-700 hover:bg-sand-200 peer-checked:border-gold-500 peer-checked:bg-gold-50 peer-checked:font-semibold peer-checked:text-gold-800 peer-checked:shadow-card`,
  high: `${CHIP_BASE} border-sand-200 bg-sand-100 text-sand-700 hover:bg-sand-200 peer-checked:border-error-border peer-checked:bg-error-bg peer-checked:font-semibold peer-checked:text-error peer-checked:shadow-card`,
};

export function AssignTaskForm({
  lodges,
  defaultLodge,
}: {
  lodges: LodgeLite[];
  defaultLodge: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setOk(false);

    const fd = new FormData(e.currentTarget);
    const lodgeId = String(fd.get("lodge_id") ?? "");
    const title = String(fd.get("title") ?? "").trim();
    if (!lodgeId) return setError("Choose a lodge.");
    if (!title) return setError("Title is required.");

    const id = newUuid();
    const supabase = createClient();
    let uploaded: string[] = [];
    try {
      if (photos.length) {
        setBusy(`Uploading ${photos.length} photo${photos.length > 1 ? "s" : ""}...`);
        uploaded = await uploadTaskPhotos(
          supabase,
          lodgeId,
          id,
          "ref",
          photos.map((p) => p.blob)
        );
      }
      setBusy("Saving task...");
      const res = await createTask({
        id,
        lodge_id: lodgeId,
        title,
        description: String(fd.get("description") ?? ""),
        priority: String(fd.get("priority") ?? "medium"),
        due_date: String(fd.get("due_date") ?? ""),
        photos: uploaded,
      });
      if (!res.ok) {
        await removeTaskPhotos(supabase, uploaded);
        setError(res.error);
        return;
      }
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
      setPhotos([]);
      formRef.current?.reset();
      setOk(true);
      router.refresh();
    } catch (err) {
      await removeTaskPhotos(supabase, uploaded);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Select lodge *</label>
          <select
            name="lodge_id"
            defaultValue={defaultLodge}
            disabled={disabled}
            className={INPUT}
          >
            {lodges.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={LABEL}>Due date</label>
          <input name="due_date" type="date" disabled={disabled} className={INPUT} />
        </div>
      </div>

      <div>
        <label className={LABEL}>Task title *</label>
        <input
          name="title"
          required
          maxLength={200}
          disabled={disabled}
          placeholder="e.g. Fix leaking tap in cottage 4"
          className={INPUT}
        />
      </div>

      <div>
        <label className={LABEL}>Detailed work instructions</label>
        <textarea
          name="description"
          rows={4}
          maxLength={4000}
          disabled={disabled}
          placeholder="What needs to be done, where, and any details from the trip."
          className={INPUT}
        />
      </div>

      <fieldset>
        <legend className={LABEL}>Priority level *</legend>
        <div className="grid grid-cols-3 gap-2">
          {TASK_PRIORITIES.map((p) => (
            <label key={p} className="relative">
              <input
                type="radio"
                name="priority"
                value={p}
                defaultChecked={p === "medium"}
                disabled={disabled}
                className="peer sr-only"
              />
              <span className={PRIORITY_CHIP[p]}>
                {p === "high" && (
                  <span className="h-1.5 w-1.5 rounded-full bg-error" aria-hidden="true" />
                )}
                {PRIORITY_LABEL[p]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <PhotoPicker
        photos={photos}
        setPhotos={setPhotos}
        max={MAX_PHOTOS}
        label="Reference photos"
        disabled={disabled}
      />

      {error && (
        <p className="rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-error">{error}</p>
      )}
      {ok && (
        <p className="rounded-lg border border-success-border bg-success-bg px-3 py-2 text-sm text-success">
          Task assigned. The lodge managers have been notified.
        </p>
      )}

      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end border-t border-sand-200 bg-white px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6">
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-olive-600 px-5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-olive-700 active:bg-olive-800 disabled:opacity-60 sm:w-auto"
        >
          <Icon name="send" className="h-4 w-4" />
          {busy ?? "Assign task & notify managers"}
        </button>
      </div>
    </form>
  );
}
