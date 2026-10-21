"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Guest itinerary photos: a slideshow with arrows, dots and swipe; clicking a
// photo opens it full screen (arrows, swipe, Esc to close).
// The PDF and print show a fixed grid of the first three instead (.pdf-only).

const Arrow = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={dir === "left" ? "M15 18l-6-6 6-6" : "M9 6l6 6-6 6"} />
  </svg>
);

function useSwipe(onLeft: () => void, onRight: () => void) {
  const start = useRef<number | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => (start.current = e.touches[0].clientX),
    onTouchEnd: (e: React.TouchEvent) => {
      if (start.current === null) return;
      const dx = e.changedTouches[0].clientX - start.current;
      if (Math.abs(dx) > 40) (dx < 0 ? onLeft : onRight)();
      start.current = null;
    },
  };
}

export function PhotoCarousel({ photos, label }: { photos: string[]; label: string }) {
  const [i, setI] = useState(0);
  const [open, setOpen] = useState(false);
  const n = photos.length;
  const next = useCallback(() => setI((x) => (x + 1) % n), [n]);
  const prev = useCallback(() => setI((x) => (x - 1 + n) % n), [n]);
  const swipe = useSwipe(next, prev);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, next, prev]);

  if (!n) return null;
  const btn =
    "absolute top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-olive-800 shadow-card transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500";

  return (
    <>
      {/* interactive slideshow (screen) */}
      <div className="pdf-hide relative mt-3 overflow-hidden rounded-lg bg-sand-200" {...swipe}>
        <button type="button" onClick={() => setOpen(true)} className="block w-full" aria-label={`Open ${label} photo ${i + 1} of ${n} full screen`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- public storage URL */}
          <img src={photos[i]} alt={`${label}, photo ${i + 1} of ${n}`} className="aspect-[16/9] w-full cursor-zoom-in object-cover" />
        </button>
        {n > 1 && (
          <>
            <button type="button" onClick={prev} className={`${btn} left-2`} aria-label="Previous photo">
              <Arrow dir="left" />
            </button>
            <button type="button" onClick={next} className={`${btn} right-2`} aria-label="Next photo">
              <Arrow dir="right" />
            </button>
            <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
              {photos.map((_, k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setI(k)}
                  className={`h-2 rounded-full transition-all ${k === i ? "w-5 bg-white" : "w-2 bg-white/60 hover:bg-white/80"}`}
                  aria-label={`Photo ${k + 1}`}
                  aria-current={k === i}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* fixed grid for the PDF and print */}
      <div className={`pdf-only mt-3 gap-2 ${n > 1 ? "grid-cols-3" : "grid-cols-1"}`}>
        {photos.slice(0, 3).map((src, k) => (
          // eslint-disable-next-line @next/next/no-img-element -- public storage URL
          <img key={k} src={src} alt="" className={`w-full rounded-lg object-cover ${n > 1 ? "aspect-[4/3]" : "aspect-[16/9]"}`} />
        ))}
      </div>

      {/* full-screen view */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${label} photos`}
          onClick={() => setOpen(false)}
          {...swipe}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- public storage URL */}
          <img src={photos[i]} alt={`${label}, photo ${i + 1} of ${n}`} className="max-h-full max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-2xl leading-none text-white hover:bg-white/25"
            aria-label="Close"
          >
            &times;
          </button>
          {n > 1 && (
            <>
              <button type="button" onClick={(e) => (e.stopPropagation(), prev())} className={`${btn} left-4`} aria-label="Previous photo">
                <Arrow dir="left" />
              </button>
              <button type="button" onClick={(e) => (e.stopPropagation(), next())} className={`${btn} right-4`} aria-label="Next photo">
                <Arrow dir="right" />
              </button>
              <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
                {i + 1} / {n}
              </p>
            </>
          )}
        </div>
      )}
    </>
  );
}
