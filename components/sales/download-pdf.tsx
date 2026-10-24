"use client";

import { useState } from "react";

// A real PDF download of the guest itinerary: same design, same photos.
// Each part marked data-pdf-block (cover, each day, prices, terms...) is
// captured as it looks on screen and placed on A4 pages without being cut,
// unless it is taller than a page. Links (lodge websites) stay clickable.

const A4 = { w: 210, h: 297 };
const MARGIN = 10;
const GAP = 4; // mm between parts

function waitForImages(root: HTMLElement) {
  return Promise.all(
    Array.from(root.querySelectorAll("img")).map((img) =>
      img.complete && img.naturalWidth ? null : new Promise((r) => ((img.onload = r), (img.onerror = r)))
    )
  );
}

export function DownloadPdfButton({ fileName, rootId = "itinerary" }: { fileName: string; rootId?: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const root = document.getElementById(rootId);
    if (!root || busy) return;
    setError(null);
    setBusy("Preparing your PDF...");
    const html = document.documentElement;
    html.dataset.pdf = "1"; // switches slideshows to photo grids, hides buttons
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await waitForImages(root);
      const [{ toCanvas }, { jsPDF }] = await Promise.all([import("html-to-image"), import("jspdf")]);
      const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
      const blocks = Array.from(root.querySelectorAll<HTMLElement>("[data-pdf-block]"));
      let y = MARGIN;
      let first = true;

      for (let b = 0; b < blocks.length; b++) {
        setBusy(`Preparing your PDF... ${Math.round((b / blocks.length) * 100)}%`);
        const el = blocks[b];
        const bleed = el.dataset.pdfBlock === "cover"; // the cover runs edge to edge
        const x = bleed ? 0 : MARGIN;
        const w = bleed ? A4.w : A4.w - 2 * MARGIN;
        // html-to-image paints backgroundColor over the captured element itself, so a dark
        // panel (price card, footer) must keep its own colour; white only where it has none.
        const own = getComputedStyle(el).backgroundColor;
        const background = !own || own === "transparent" || /rgba\([^)]*,\s*0\)$/.test(own) ? "#ffffff" : own;
        const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: background, cacheBust: false, imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" });
        const h = (canvas.height * w) / canvas.width;
        const usable = A4.h - 2 * MARGIN;

        if (bleed && first) y = 0;
        else if (y + h > A4.h - MARGIN && y > MARGIN) {
          pdf.addPage();
          y = MARGIN;
        }
        first = false;

        if (h <= usable || bleed) {
          pdf.addImage(canvas.toDataURL("image/jpeg", 0.86), "JPEG", x, y, w, h, undefined, "FAST");
          // keep links clickable
          const box = el.getBoundingClientRect();
          const mmPerPx = w / box.width;
          el.querySelectorAll<HTMLAnchorElement>("a[href^='http']").forEach((a) => {
            const r = a.getBoundingClientRect();
            pdf.link(x + (r.left - box.left) * mmPerPx, y + (r.top - box.top) * mmPerPx, r.width * mmPerPx, r.height * mmPerPx, { url: a.href });
          });
          y += h + (bleed ? 6 : GAP);
        } else {
          // taller than a page: slice it across pages
          const pxPerPage = (usable * canvas.width) / w;
          for (let top = 0; top < canvas.height; top += pxPerPage) {
            const sliceH = Math.min(pxPerPage, canvas.height - top);
            const part = document.createElement("canvas");
            part.width = canvas.width;
            part.height = sliceH;
            part.getContext("2d")!.drawImage(canvas, 0, top, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
            if (y > MARGIN) {
              pdf.addPage();
              y = MARGIN;
            }
            const ph = (sliceH * w) / canvas.width;
            pdf.addImage(part.toDataURL("image/jpeg", 0.86), "JPEG", x, y, w, ph, undefined, "FAST");
            y += ph + GAP;
          }
        }
      }

      // page numbers
      const pages = pdf.getNumberOfPages();
      for (let p = 1; p <= pages; p++) {
        pdf.setPage(p);
        pdf.setFontSize(8);
        pdf.setTextColor(140, 125, 96);
        pdf.text(`Page ${p} of ${pages}`, A4.w - MARGIN, A4.h - 4, { align: "right" });
      }
      pdf.save(fileName);
    } catch (e) {
      console.error(e);
      setError("The PDF could not be made on this device. Use Print and choose Save as PDF instead.");
    } finally {
      delete html.dataset.pdf;
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 print:hidden">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex min-h-10 items-center rounded-lg border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-700 transition hover:bg-sand-50"
        >
          Print
        </button>
        <button
          type="button"
          onClick={run}
          disabled={!!busy}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-olive-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-olive-700 disabled:opacity-70"
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
          </svg>
          {busy ?? "Download PDF"}
        </button>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
