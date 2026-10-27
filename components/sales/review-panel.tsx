"use client";

// Rows waiting for a decision (Reader rules, Unknown words) with one-click Approve / Reject.
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { reviewRecord } from "@/app/(dashboard)/sales/admin/actions";

export interface ReviewRow {
  id: string;
  cells: { label: string; text: string }[];
  canApprove: boolean; // what it means is filled in
}

export function ReviewPanel({ entityKey, rows, needs }: { entityKey: string; rows: ReviewRow[]; needs?: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);

  function decide(id: string, decision: "approve" | "reject") {
    setError(null);
    start(async () => {
      const res = await reviewRecord(entityKey, id, decision);
      if (res.error) setError(res.error);
      else {
        setDone((d) => [...d, id]);
        router.refresh();
      }
    });
  }

  const open = rows.filter((r) => !done.includes(r.id));
  if (!open.length) return null;
  return (
    <section className={`${ui.card} space-y-3 p-4`} aria-label="Waiting for approval">
      <div>
        <h2 className="text-lg">Waiting for approval ({open.length})</h2>
        <p className="text-sm text-sand-500">Approve to let the reader use it at once; reject to keep it out.{needs ? ` ${needs}` : ""}</p>
      </div>
      {error && <p className={ui.alertError}>{error}</p>}
      <ul className="divide-y divide-sand-200">
        {open.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
            <dl className="grid min-w-0 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[auto_1fr]">
              {r.cells.map((c) => (
                <div key={c.label} className="contents">
                  <dt className="text-xs text-sand-500">{c.label}</dt>
                  <dd className="min-w-0 break-words">{c.text || "-"}</dd>
                </div>
              ))}
            </dl>
            <div className="flex shrink-0 gap-2">
              {r.canApprove ? (
                <button type="button" disabled={busy} onClick={() => decide(r.id, "approve")} className={`${ui.btnPrimary} ${ui.btnSm}`}>
                  Approve
                </button>
              ) : (
                <Link href={`/sales/admin/${entityKey}/${r.id}`} className={`${ui.btnSecondary} ${ui.btnSm}`}>
                  Teach it
                </Link>
              )}
              <button type="button" disabled={busy} onClick={() => decide(r.id, "reject")} className={`${ui.btnGhost} ${ui.btnSm}`}>
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
