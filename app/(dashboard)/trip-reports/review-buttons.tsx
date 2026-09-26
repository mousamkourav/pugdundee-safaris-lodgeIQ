"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/tasks";
import { approveTask, declineTask, deleteTask } from "./actions";

export function ReviewButtons({
  taskId,
  canReview,
  canDelete,
}: {
  taskId: string;
  canReview: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDeclining(false);
      setReason("");
      router.refresh();
    });
  }

  if (!canReview && !canDelete) return null;

  return (
    <div className="space-y-2">
      {declining ? (
        <div className="space-y-2 rounded-lg border border-sand-200 bg-sand-50 p-3">
          <label className="block text-sm text-sand-700">Reason for declining *</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={pending}
            placeholder="What still needs to be fixed?"
            className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => run(() => declineTask(taskId, reason))}
              className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {pending ? "Declining..." : "Confirm decline"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setDeclining(false);
                setError(null);
              }}
              className="rounded-lg border border-sand-300 bg-white px-4 py-2 text-sm text-sand-700 hover:bg-sand-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canReview && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => approveTask(taskId))}
                className="flex-1 rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white hover:bg-olive-700 disabled:opacity-60 sm:flex-none"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setDeclining(true)}
                className="flex-1 rounded-lg border border-error/30 px-4 py-2 text-sm text-error hover:bg-error-bg disabled:opacity-60 sm:flex-none"
              >
                Decline
              </button>
            </>
          )}
          {canDelete && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm("Delete this task and all its photos? This cannot be undone.")) {
                  run(() => deleteTask(taskId));
                }
              }}
              className="rounded-lg px-3 py-2 text-sm text-sand-500 hover:bg-sand-100 hover:text-error disabled:opacity-60"
            >
              Delete
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error">{error}</p>
      )}
    </div>
  );
}
