"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { compressImage, ImageDecodeError } from "@/lib/image-compress";
import { Icon } from "@/components/icons";

export type PickedPhoto = { key: string; blob: Blob; preview: string };

// Choose photos, compress them in the browser, preview and remove. Nothing is
// uploaded here; the parent form uploads `photos` on submit.
export function PhotoPicker({
  photos,
  setPhotos,
  max = 6,
  label = "Photos",
  required = false,
  disabled = false,
}: {
  photos: PickedPhoto[];
  setPhotos: Dispatch<SetStateAction<PickedPhoto[]>>;
  max?: number;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke preview URLs when the picker goes away.
  const latest = useRef(photos);
  latest.current = photos;
  useEffect(
    () => () => latest.current.forEach((p) => URL.revokeObjectURL(p.preview)),
    []
  );

  const remaining = max - photos.length;

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    const errs: string[] = [];
    let take = files;
    if (files.length > remaining) {
      errs.push(
        `Only ${max} photos allowed; ${files.length - Math.max(remaining, 0)} skipped.`
      );
      take = files.slice(0, Math.max(remaining, 0));
    }

    setBusy(true);
    const added: PickedPhoto[] = [];
    for (const f of take) {
      try {
        const blob = await compressImage(f);
        added.push({
          key: `${f.name}-${f.lastModified}-${Math.random().toString(36).slice(2)}`,
          blob,
          preview: URL.createObjectURL(blob),
        });
      } catch (err) {
        errs.push(
          err instanceof ImageDecodeError
            ? err.message
            : `"${f.name}" could not be processed.`
        );
      }
    }
    setPhotos((prev) => {
      const room = max - prev.length;
      added.slice(room).forEach((p) => URL.revokeObjectURL(p.preview));
      return [...prev, ...added.slice(0, room)];
    });
    setErrors(errs);
    setBusy(false);
  }

  function remove(key: string) {
    setPhotos((prev) => {
      const hit = prev.find((p) => p.key === key);
      if (hit) URL.revokeObjectURL(hit.preview);
      return prev.filter((p) => p.key !== key);
    });
  }

  const pickDisabled = disabled || busy || remaining <= 0;

  return (
    <div>
      <p className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-sand-500">
        <span>
          {label}
          {required && " *"}
        </span>
        <span className="font-medium normal-case tracking-normal tabular">
          {photos.length}/{max}
        </span>
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={onPick}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pickDisabled}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sand-300 bg-sand-50 px-4 py-6 text-center transition hover:border-olive-400 hover:bg-olive-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-sand-200 text-sand-700">
          <Icon name="camera" className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold text-olive-800">
          {busy
            ? "Preparing photos..."
            : remaining <= 0
              ? "Photo limit reached"
              : photos.length
                ? "Add more photos"
                : "Tap to choose photos"}
        </span>
        <span className="text-xs text-sand-500">
          Up to {max} photos. They are compressed on this device before upload.
        </span>
      </button>

      {photos.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {photos.map((p) => (
            <div
              key={p.key}
              className="relative aspect-square overflow-hidden rounded-lg border border-sand-200 bg-sand-100 shadow-card"
            >
              <img src={p.preview} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(p.key)}
                disabled={disabled}
                aria-label="Remove photo"
                className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-olive-900/75 text-white transition hover:bg-error disabled:opacity-50"
              >
                <Icon name="x" className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-lg border border-error-border bg-error-bg px-3 py-2 text-xs text-error">
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
