"use client";

// Guest-facing: keep it simple and friendly.
export default function ItineraryError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-sand-50 p-6 text-center">
      <div className="space-y-3">
        <h1 className="text-2xl">Your itinerary could not be loaded</h1>
        <p className="text-sm text-sand-500">Please try again in a moment. If it still does not open, contact your Pugdundee Safaris consultant.</p>
        <button type="button" onClick={reset} className="inline-flex min-h-10 items-center rounded-lg bg-olive-600 px-4 py-2 text-sm font-semibold text-white hover:bg-olive-700">
          Try again
        </button>
      </div>
    </div>
  );
}
