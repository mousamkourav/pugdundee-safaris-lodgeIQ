"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { deleteQuery } from "@/app/(dashboard)/sales/queries/[id]/actions";

// Delete a query (Sales admins). Asks for confirmation and an optional reason.
export function DeleteQueryButton({ queryId, queryNo, guestName }: { queryId: string; queryNo: string; guestName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove() {
    setError(null);
    start(async () => {
      try {
        const res = await deleteQuery(queryId, reason);
        if (res.error) setError(res.error);
        else {
          router.push("/sales/queries");
          router.refresh();
        }
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <>
      <button type="button" className={ui.btnDangerOutline} onClick={() => setOpen(true)}>
        <Icon name="trash" className="h-[18px] w-[18px]" />
        Delete query
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-olive-800/35 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label={`Delete ${queryNo}`}>
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 shadow-overlay">
            <h2 className="text-lg">Delete {queryNo}?</h2>
            <p className="text-sm text-sand-600">
              {guestName}&apos;s query will be removed from every list and its client links will stop working. Its versions and history are kept for the record.
            </p>
            <label className="block">
              <span className={ui.label}>Reason (optional)</span>
              <input className={ui.inputSm} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate of PS-2026-0012, test query" maxLength={300} />
            </label>
            {error && <p className={ui.alertError}>{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row-reverse">
              <button type="button" className={`${ui.btnDanger} ${ui.btnSm}`} disabled={pending} onClick={remove}>
                {pending ? "Deleting..." : "Delete query"}
              </button>
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={pending} onClick={() => setOpen(false)}>
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
