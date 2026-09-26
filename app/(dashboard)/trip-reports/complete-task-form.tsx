"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PhotoPicker, type PickedPhoto } from "@/components/photo-picker";
import { MAX_PHOTOS, removeTaskPhotos, uploadTaskPhotos } from "@/lib/tasks";
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
        className="w-full rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white hover:bg-olive-700 sm:w-auto"
      >
        {resubmit ? "Fix and resubmit" : "Mark complete"}
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
      className="space-y-3 rounded-lg border border-sand-200 bg-sand-50 p-3"
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
        <label className="mb-1 block text-sm text-sand-700">Comment</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={4000}
          disabled={disabled}
          placeholder="What was done?"
          className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500 disabled:bg-sand-100"
        />
      </div>
      {resubmit && (
        <p className="text-xs text-sand-500">
          Resubmitting replaces the previously submitted photos.
        </p>
      )}
      {error && (
        <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{error}</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white hover:bg-olive-700 disabled:opacity-60"
        >
          {busy ?? "Submit for review"}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={disabled}
          className="rounded-lg border border-sand-300 bg-white px-4 py-2 text-sm text-sand-700 hover:bg-sand-100 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
