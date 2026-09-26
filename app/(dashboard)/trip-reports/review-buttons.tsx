"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/tasks";
import { Icon } from "@/components/icons";
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
        <div className="space-y-3 rounded-xl border border-error-border bg-error-bg/60 p-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-error">
            Reason for declining *
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={2000}
            disabled={pending}
            placeholder="What still needs to be fixed?"
            className="w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => run(() => declineTask(taskId, reason))}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-error px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60 sm:min-h-10"
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
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-700 transition hover:bg-sand-100 sm:min-h-10"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {canReview && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => approveTask(taskId))}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-success px-5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-green-800 disabled:opacity-60 sm:min-h-10 sm:flex-none"
              >
                <Icon name="checkCircle" className="h-4 w-4" />
                Approve &amp; close
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setDeclining(true)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-error transition hover:bg-error-bg disabled:opacity-60 sm:min-h-10 sm:flex-none"
              >
                <Icon name="xCircle" className="h-4 w-4" />
                Decline with note
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
              className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-sand-500 transition hover:bg-sand-100 hover:text-error disabled:opacity-60 sm:min-h-10"
            >
              <Icon name="trash" className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-error">{error}</p>
      )}
    </div>
  );
}
