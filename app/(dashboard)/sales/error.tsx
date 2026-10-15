"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";

// Shown instead of a broken screen when anything in /sales fails to load.
export default function SalesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Sales page error:", error);
  }, [error]);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div className="mx-auto max-w-xl py-12">
      <div className={`${ui.card} space-y-4 p-6 text-center`}>
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-error-bg text-error">
          <Icon name="alert" className="h-6 w-6" />
        </span>
        <h1 className="text-xl">{offline ? "You seem to be offline" : "This page could not be loaded"}</h1>
        <p className="text-sm text-sand-600">
          {offline
            ? "Check your internet connection, then try again."
            : "Something went wrong on our side. Try again; if it keeps happening, send the reference below to the admin."}
        </p>
        {error.digest && <p className="text-xs text-sand-500">Reference: {error.digest}</p>}
        <p className="text-xs text-sand-500">Unsaved itineraries are kept on this computer and offered back when you open Create itinerary again.</p>
        <div className="flex justify-center gap-2">
          <button type="button" className={ui.btnPrimary} onClick={reset}>Try again</button>
          <Link href="/sales" className={ui.btnSecondary}>Sales dashboard</Link>
        </div>
      </div>
    </div>
  );
}
