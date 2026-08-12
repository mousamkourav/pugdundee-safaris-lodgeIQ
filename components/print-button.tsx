"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg border border-sand-200 px-4 py-2 text-sm text-sand-700 hover:bg-sand-50"
    >
      Print / Save PDF
    </button>
  );
}
