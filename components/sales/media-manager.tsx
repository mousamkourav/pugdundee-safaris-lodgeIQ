"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PhotoPicker, type PickedPhoto } from "@/components/photo-picker";
import { Icon } from "@/components/icons";
import { ui, Badge } from "@/components/ui";
import { MEDIA_BUCKET, type MediaItem, type MediaOwner } from "@/lib/sales/master/types";
import {
  addMedia,
  setCover,
  moveMedia,
  updateCaption,
  deleteMedia,
} from "@/app/(dashboard)/sales/admin/media-actions";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Photo gallery for one owner (a lodge, room, park, add-on, or brand images).
// Photos are compressed in the browser by PhotoPicker, uploaded straight to
// Storage, then recorded in sales_media by a server action.
export function MediaManager({
  owner,
  ownerId,
  items,
  max,
  title = "Photos",
  hint = "The starred photo is the cover used in itineraries. Use the arrows to change the order.",
}: {
  owner: MediaOwner;
  ownerId: string | null;
  items: MediaItem[];
  max: number;
  title?: string;
  hint?: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const busy = uploading || pending;
  const room = Math.max(0, max - items.length);

  async function upload() {
    if (!picked.length) return;
    setError(null);
    setUploading(true);
    const supabase = createClient();
    const bucket = supabase.storage.from(MEDIA_BUCKET);
    const paths: string[] = [];
    const failed: string[] = [];

    for (const p of picked) {
      const ext = EXT[p.blob.type] ?? "jpg";
      const path = `${owner}/${ownerId ?? "brand"}/${newId()}.${ext}`;
      const { error: upErr } = await bucket.upload(path, p.blob, {
        contentType: p.blob.type || "image/jpeg",
        upsert: false,
      });
      if (upErr) failed.push(upErr.message);
      else paths.push(path);
    }

    if (paths.length) {
      const res = await addMedia(owner, ownerId, paths);
      if (res.error) {
        await bucket.remove(paths); // do not leave orphan files behind
        failed.push(res.error);
      }
    }

    picked.forEach((p) => URL.revokeObjectURL(p.preview));
    setPicked([]);
    setUploading(false);
    if (failed.length) setError(`${failed.length} photo(s) could not be uploaded: ${failed[0]}`);
    router.refresh();
  }

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      router.refresh();
    });
  }

  return (
    <section className={`${ui.card} space-y-5 p-5 sm:p-6`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg">{title}</h2>
          <p className="text-sm text-sand-500">{hint}</p>
        </div>
        <span className="tabular text-xs font-semibold text-sand-500">
          {items.length}/{max}
        </span>
      </div>

      {error && <p className={ui.alertError}>{error}</p>}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m, i) => (
            <figure key={m.id} className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-card">
              <div className="relative aspect-[4/3] bg-sand-100">
                {/* eslint-disable-next-line @next/next/no-img-element -- Supabase public URL, sizes vary */}
                <img src={m.url} alt={m.caption ?? ""} loading="lazy" className="h-full w-full object-cover" />
                {m.is_cover && (
                  <span className="absolute left-2 top-2">
                    <Badge tone="gold">Cover</Badge>
                  </span>
                )}
              </div>
              <figcaption className="space-y-2 p-2.5">
                <input
                  defaultValue={m.caption ?? ""}
                  placeholder="Caption (optional)"
                  disabled={busy}
                  onBlur={(e) => {
                    const v = e.currentTarget.value;
                    if (v.trim() !== (m.caption ?? "")) run(() => updateCaption(m.id, v));
                  }}
                  className={ui.inputSm}
                />
                <div className="flex items-center justify-between gap-1">
                  <div className="flex gap-1">
                    <button
                      type="button"
                      title="Move earlier"
                      aria-label="Move earlier"
                      disabled={busy || i === 0}
                      onClick={() => run(() => moveMedia(m.id, -1))}
                      className={`${ui.btnGhost} ${ui.btnSm} px-2`}
                    >
                      <Icon name="chevronLeft" className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Move later"
                      aria-label="Move later"
                      disabled={busy || i === items.length - 1}
                      onClick={() => run(() => moveMedia(m.id, 1))}
                      className={`${ui.btnGhost} ${ui.btnSm} px-2`}
                    >
                      <Icon name="chevronLeft" className="h-4 w-4 rotate-180" />
                    </button>
                  </div>
                  <div className="flex gap-1">
                    {!m.is_cover && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => setCover(m.id))}
                        className={`${ui.btnGhost} ${ui.btnSm}`}
                      >
                        Make cover
                      </button>
                    )}
                    <button
                      type="button"
                      title="Delete photo"
                      aria-label="Delete photo"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm("Delete this photo?")) run(() => deleteMedia(m.id));
                      }}
                      className={`${ui.btnGhost} ${ui.btnSm} px-2 !text-error`}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {room > 0 ? (
        <div className="space-y-3">
          <PhotoPicker photos={picked} setPhotos={setPicked} max={room} label="Add photos" disabled={busy} />
          {picked.length > 0 && (
            <div className="flex justify-end">
              <button type="button" onClick={upload} disabled={busy} className={ui.btnPrimary}>
                <Icon name="camera" className="h-[18px] w-[18px]" />
                {uploading ? "Uploading..." : `Upload ${picked.length} photo${picked.length === 1 ? "" : "s"}`}
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-sand-500">Photo limit reached. Delete one to add another.</p>
      )}
    </section>
  );
}
