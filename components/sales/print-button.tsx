"use client";

import { Icon } from "@/components/icons";

// The browser's own "Save as PDF" gives a clean, selectable PDF with no
// extra library. Print styles on the page hide this button.
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-olive-600 px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-olive-700 print:hidden"
    >
      <Icon name="receipt" className="h-[18px] w-[18px]" />
      Download PDF
    </button>
  );
}
