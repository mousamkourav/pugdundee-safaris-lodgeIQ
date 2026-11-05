"use client";

import { useState, useTransition } from "react";
import { ui } from "@/components/ui";
import { createMissingBookings } from "@/app/(dashboard)/sales/payments/actions";

// Admins: bookings for queries booked before the tracker existed.
export function MakeMissingBookings() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button
        type="button"
        className={`${ui.btnSecondary} ${ui.btnSm}`}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await createMissingBookings();
            setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: `${r.made ?? 0} booking${r.made === 1 ? "" : "s"} made from booked queries (${r.skipped ?? 0} already there or without a saved version).` });
          })
        }
      >
        {pending ? "Making bookings..." : "Make bookings for booked queries"}
      </button>
      <span className="text-xs text-sand-500">For queries booked before Payments existed. Safe to press again.</span>
      {msg && <span className={msg.ok ? "text-success" : "text-error"}>{msg.text}</span>}
    </div>
  );
}
