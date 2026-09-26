"use client";

import { useEffect, useState } from "react";
import type { LodgeLite } from "@/lib/lodges";
import { Icon } from "@/components/icons";
import { AssignTaskForm } from "./assign-task-form";

// Header button + right-hand slide-over that hosts the assign form. Pure
// presentation: the form inside is the same AssignTaskForm with the same
// submit logic. The panel stays mounted while closed so a half-filled form
// (and its picked photos) survives closing and reopening.
export function AssignTaskDrawer({
  lodges,
  defaultLodge,
}: {
  lodges: LodgeLite[];
  defaultLodge: string;
}) {
  const [open, setOpen] = useState(false);
  const lodgeName = lodges.find((l) => l.id === defaultLodge)?.name;

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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-olive-600 px-5 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-olive-700 active:bg-olive-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 focus-visible:ring-offset-2 sm:w-auto"
      >
        <Icon name="plus" className="h-4 w-4" />
        Assign new task
      </button>

      <div
        className={
          "fixed inset-0 z-50 transition " + (open ? "visible" : "invisible pointer-events-none")
        }
        aria-hidden={!open}
      >
        <div
          className={
            "absolute inset-0 bg-olive-800/35 backdrop-blur-sm transition-opacity duration-200 " +
            (open ? "opacity-100" : "opacity-0")
          }
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="assign-task-title"
          className={
            "absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white shadow-overlay transition-transform duration-200 " +
            (open ? "translate-x-0" : "translate-x-full")
          }
        >
          <div className="flex items-start gap-3 border-b border-sand-200 bg-sand-100 px-5 py-4 sm:px-6">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-olive-600 text-white">
              <Icon name="clipboard" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="assign-task-title" className="flex flex-wrap items-center gap-2 text-lg leading-6 sm:text-xl">
                Assign operational task
                {lodgeName && (
                  <span className="rounded-full bg-olive-100 px-2.5 py-0.5 font-sans text-xs font-semibold text-olive-700">
                    {lodgeName}
                  </span>
                )}
              </h2>
              <p className="mt-0.5 text-sm text-sand-500">
                Lodge managers are notified in-app as soon as it is assigned.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 text-sand-600 transition hover:bg-sand-200"
              aria-label="Close"
            >
              <Icon name="x" className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 sm:p-6">
            <AssignTaskForm lodges={lodges} defaultLodge={defaultLodge} />
          </div>
        </div>
      </div>
    </>
  );
}
