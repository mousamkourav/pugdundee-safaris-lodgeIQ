"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";

// Thumbnail grid whose photos open full-size in an in-page overlay (not a new
// tab). Close with the X, a click outside the photo, or Escape; arrow keys /
// buttons step through the set. Safe to nest inside another modal: its Escape
// handler runs first and stops the parent modal from closing too.
export function PhotoGrid({
  urls,
  className = "grid grid-cols-3 gap-2",
}: {
  urls: string[];
  className?: string;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const count = urls.length;
  const close = useCallback(() => setIndex(null), []);
  const step = useCallback(
    (d: number) => setIndex((i) => (i === null ? i : (i + d + count) % count)),
    [count]
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
      else return;
      e.stopImmediatePropagation();
    };
    // Capture phase: runs before the parent popup's own Escape listener.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, close, step]);

  if (!count) return null;
  const current = index === null ? null : urls[index];

  return (
    <>
      <div className={className}>
        {urls.map((u, i) => (
          <button
            key={u}
            type="button"
            onClick={() => setIndex(i)}
            className="block aspect-[4/3] overflow-hidden rounded-lg border border-sand-200 bg-sand-100 transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
            aria-label={`View photo ${i + 1} of ${count}`}
          >
            <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
          onClick={close}
        >
          <img
            src={current}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain shadow-overlay"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button"
            onClick={close}
            className="absolute right-3 top-3 rounded-full bg-white/15 p-2 text-white transition hover:bg-white/25"
            aria-label="Close photo"
          >
            <Icon name="x" className="h-6 w-6" />
          </button>
          {count > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white transition hover:bg-white/25"
                aria-label="Previous photo"
              >
                <Icon name="chevronLeft" className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-2 text-white transition hover:bg-white/25"
                aria-label="Next photo"
              >
                <Icon name="chevronLeft" className="h-6 w-6 rotate-180" />
              </button>
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
                {(index ?? 0) + 1} / {count}
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}
