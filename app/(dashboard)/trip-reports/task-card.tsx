"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import {
  PRIORITY_BADGE,
  PRIORITY_LABEL,
  STATUS_ACCENT,
  STATUS_BADGE,
  STATUS_LABEL,
  formatDate,
  type Task,
} from "@/lib/tasks";
import { CompleteTaskForm } from "./complete-task-form";
import { ReviewButtons } from "./review-buttons";

// All display data is resolved on the server and passed in, so the popup needs
// no client fetch. The action components (CompleteTaskForm/ReviewButtons) are
// reused unchanged inside the popup.
export type TaskCardData = {
  task: Task;
  refUrls: string[];
  doneUrls: string[];
  assignedByName: string;
  submittedByName: string;
  resolvedByName: string;
  canSubmit: boolean;
  canReview: boolean;
  canDelete: boolean;
  lodgeName?: string;
};

function Thumbs({ label, urls, icon }: { label: string; urls: string[]; icon: string }) {
  if (!urls.length) return null;
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sand-600">
        <Icon name={icon} className="h-3.5 w-3.5" />
        {label} ({urls.length})
      </p>
      <div className="grid grid-cols-3 gap-2">
        {urls.map((u) => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] overflow-hidden rounded-lg border border-sand-200 bg-sand-100">
            <img src={u} alt="" loading="lazy" className="h-full w-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  );
}

export function TaskCard(d: TaskCardData) {
  const { task: t } = d;
  const [open, setOpen] = useState(false);
  const accent = STATUS_ACCENT[t.status] ?? STATUS_ACCENT.pending;
  const overdue =
    t.due_date &&
    (t.status === "pending" || t.status === "declined") &&
    t.due_date < new Date().toISOString().slice(0, 10);
  const thumb = d.refUrls[0] ?? d.doneUrls[0] ?? null;
  const photoCount = d.refUrls.length + d.doneUrls.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/* compact card */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-3 rounded-xl border border-l-4 border-sand-200 bg-white p-3 text-left shadow-card transition hover:shadow-card-hover sm:p-4 ${accent.bar}`}
      >
        <span className="relative hidden h-14 w-16 shrink-0 overflow-hidden rounded-lg border border-sand-200 bg-sand-100 sm:block">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full w-full place-items-center text-sand-400">
              <Icon name="image" className="h-5 w-5" />
            </span>
          )}
          {photoCount > 0 && (
            <span className="absolute bottom-0.5 right-0.5 rounded bg-olive-900/70 px-1 text-[10px] font-semibold text-white">
              {photoCount}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[t.status]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
              {STATUS_LABEL[t.status]}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PRIORITY_BADGE[t.priority] ?? PRIORITY_BADGE.medium}`}>
              {PRIORITY_LABEL[t.priority] ?? t.priority}
            </span>
          </span>
          <span className="block truncate font-semibold text-sand-900">{t.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-sand-500">
            <span className="flex items-center gap-1">
              <Icon name="user" className="h-3 w-3" />
              By {d.assignedByName}
            </span>
            <span>Assigned {formatDate(t.created_at)}</span>
            {d.lodgeName && (
              <span className="flex items-center gap-1">
                <Icon name="mapPin" className="h-3 w-3" />
                {d.lodgeName}
              </span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {t.due_date && (
            <span className={"block text-xs font-medium " + (overdue ? "text-error" : "text-sand-500")}>
              {overdue ? "Overdue " : "Due "}
              {formatDate(t.due_date)}
            </span>
          )}
          <Icon name="chevronLeft" className="ml-auto mt-1 h-4 w-4 rotate-180 text-sand-400" />
        </span>
      </button>

      {/* detail popup */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-olive-800/35 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            className="absolute left-1/2 top-1/2 flex max-h-[92vh] w-[calc(100%-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-overlay"
          >
            <div className="flex items-start gap-3 border-b border-sand-200 bg-sand-100 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[t.status]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />
                    {STATUS_LABEL[t.status]}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${PRIORITY_BADGE[t.priority] ?? PRIORITY_BADGE.medium}`}>
                    {PRIORITY_LABEL[t.priority] ?? t.priority} priority
                  </span>
                </div>
                <h2 className="break-words text-lg leading-6 sm:text-xl">{t.title}</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-sand-600 hover:bg-sand-200" aria-label="Close">
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-6">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-sand-600">
                <span className="flex items-center gap-1.5">
                  <Icon name="user" className="h-3.5 w-3.5" />
                  Assigned by <span className="font-semibold text-olive-800">{d.assignedByName}</span>
                </span>
                <span>on {formatDate(t.created_at)}</span>
                {t.due_date && (
                  <span className={"flex items-center gap-1.5 " + (overdue ? "text-error" : "")}>
                    <Icon name={overdue ? "alert" : "clock"} className="h-3.5 w-3.5" />
                    {overdue ? "Overdue: " : "Due "}
                    {formatDate(t.due_date)}
                  </span>
                )}
              </div>

              {t.description && (
                <p className="whitespace-pre-line break-words text-[15px] leading-6 text-sand-700">{t.description}</p>
              )}

              {d.refUrls.length > 0 && (
                <div className="rounded-xl border border-sand-200 bg-sand-50 p-3">
                  <Thumbs label="Reference photos" urls={d.refUrls} icon="camera" />
                </div>
              )}

              {t.status === "declined" && t.decline_reason && (
                <div className="rounded-xl border border-error-border bg-error-bg p-4">
                  <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-error">
                    <Icon name="xCircle" className="h-4 w-4" />
                    Declined{d.resolvedByName !== "-" ? ` by ${d.resolvedByName}` : ""}
                    {t.resolved_at ? ` - ${formatDate(t.resolved_at)}` : ""}
                  </p>
                  <p className="whitespace-pre-line break-words text-sm leading-6 text-error">{t.decline_reason}</p>
                </div>
              )}

              {t.submitted_at && t.status !== "pending" && (
                <div className="space-y-3 rounded-xl border border-info-border bg-info-bg/60 p-4">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-info">
                    <span className="flex items-center gap-1.5">
                      <Icon name="send" className="h-3.5 w-3.5" />
                      {t.status === "declined" ? "Last submission" : "Manager submission"}
                    </span>
                    <span className="font-semibold normal-case tracking-normal">
                      {d.submittedByName} - {formatDate(t.submitted_at)}
                    </span>
                  </p>
                  {t.completion_comment && (
                    <p className="whitespace-pre-line break-words text-sm italic leading-6 text-sand-700">&quot;{t.completion_comment}&quot;</p>
                  )}
                  <Thumbs label="Proof photos" urls={d.doneUrls} icon="checkCircle" />
                </div>
              )}

              {t.status === "resolved" && (
                <p className="flex items-center gap-1.5 rounded-lg border border-success-border bg-success-bg px-3 py-2 text-sm font-medium text-success">
                  <Icon name="checkCircle" className="h-4 w-4" />
                  Approved by {d.resolvedByName} on {formatDate(t.resolved_at)}
                </p>
              )}

              {t.status === "submitted" && !d.canReview && (
                <p className="flex items-center gap-1.5 text-xs text-sand-500">
                  <Icon name="clock" className="h-3.5 w-3.5" />
                  Waiting for {d.assignedByName} to review.
                </p>
              )}

              {(d.canSubmit || d.canReview || d.canDelete) && (
                <div className="space-y-3 border-t border-sand-100 pt-4">
                  {d.canSubmit && (
                    <CompleteTaskForm taskId={t.id} lodgeId={t.lodge_id} resubmit={t.status === "declined"} />
                  )}
                  <ReviewButtons taskId={t.id} canReview={d.canReview} canDelete={d.canDelete} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
