"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PhotoPicker, type PickedPhoto } from "@/components/photo-picker";
import { MAX_PHOTOS, removeTaskPhotos, uploadTaskPhotos } from "@/lib/tasks";
import { Icon } from "@/components/icons";
import { submitCompletion } from "./actions";

export function CompleteTaskForm({
  taskId,
  lodgeId,
  resubmit = false,
}: {
  taskId: string;
  lodgeId: string;
  resubmit?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold shadow-card transition sm:min-h-10 sm:w-auto " +
          (resubmit
            ? "bg-gold-400 text-olive-900 hover:bg-gold-300"
            : "bg-olive-600 text-white hover:bg-olive-700")
        }
      >
        <Icon name={resubmit ? "camera" : "checkCircle"} className="h-4 w-4" />
        {resubmit ? "Fix and resubmit (with new proof)" : "Mark complete"}
      </button>
    );
  }

  function close() {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setComment("");
    setError(null);
    setOpen(false);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!photos.length) return setError("Add at least one photo of the finished work.");

    const supabase = createClient();
    let uploaded: string[] = [];
    try {
      setBusy(`Uploading ${photos.length} photo${photos.length > 1 ? "s" : ""}...`);
      uploaded = await uploadTaskPhotos(
        supabase,
        lodgeId,
        taskId,
        "done",
        photos.map((p) => p.blob)
      );
      setBusy("Submitting...");
      const res = await submitCompletion({ task_id: taskId, photos: uploaded, comment });
      if (!res.ok) {
        await removeTaskPhotos(supabase, uploaded);
        setError(res.error);
        return;
      }
      close();
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
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-xl border border-sand-200 bg-sand-50 p-4"
    >
      <PhotoPicker
        photos={photos}
        setPhotos={setPhotos}
        max={MAX_PHOTOS}
        label="Completion photos"
        required
        disabled={disabled}
      />
      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-sand-500">
          Comment
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={4000}
          disabled={disabled}
          placeholder="What was done?"
          className="w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-100"
        />
      </div>
      {resubmit && (
        <p className="text-xs text-sand-500">
          Resubmitting replaces the previously submitted photos.
        </p>
      )}
      {error && (
        <p className="rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-error">{error}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-olive-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-olive-700 disabled:opacity-60 sm:min-h-10"
        >
          <Icon name="send" className="h-4 w-4" />
          {busy ?? "Submit for review"}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={disabled}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-700 transition hover:border-sand-500 hover:bg-sand-100 disabled:opacity-60 sm:min-h-10"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
