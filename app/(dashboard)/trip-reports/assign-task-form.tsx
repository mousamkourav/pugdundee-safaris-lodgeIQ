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
import { createTask } from "./actions";

const INPUT =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500 disabled:bg-sand-100";

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
    <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm text-sand-700">Lodge *</label>
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
          <label className="mb-1 block text-sm text-sand-700">Title *</label>
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
          <label className="mb-1 block text-sm text-sand-700">Priority *</label>
          <select
            name="priority"
            defaultValue="medium"
            disabled={disabled}
            className={INPUT}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm text-sand-700">Due date</label>
          <input name="due_date" type="date" disabled={disabled} className={INPUT} />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm text-sand-700">Description</label>
        <textarea
          name="description"
          rows={3}
          maxLength={4000}
          disabled={disabled}
          placeholder="What needs to be done, where, and any details from the trip."
          className={INPUT}
        />
      </div>

      <PhotoPicker
        photos={photos}
        setPhotos={setPhotos}
        max={MAX_PHOTOS}
        label="Reference photos"
        disabled={disabled}
      />

      {error && (
        <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{error}</p>
      )}
      {ok && (
        <p className="rounded-lg bg-success-bg px-3 py-2 text-sm text-success">
          Task assigned. The lodge managers have been notified.
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        className="w-full rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white hover:bg-olive-700 disabled:opacity-60 sm:w-auto"
      >
        {busy ?? "Assign task"}
      </button>
    </form>
  );
}
