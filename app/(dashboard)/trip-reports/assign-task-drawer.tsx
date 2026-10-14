"use client";

import { useEffect, useState } from "react";
import type { LodgeLite } from "@/lib/lodges";
import { Icon } from "@/components/icons";
import { AssignTripForm, type ExistingTrip } from "./assign-trip-form";

// Header button + right-hand slide-over hosting the two-step "Assign Trip &
// Tasks" flow. The panel stays mounted while closed so a half-filled form (and
// its picked photos) survives closing and reopening. With `existingTrip` it
// hosts the "add more tasks to this trip" flow instead.
export function AssignTaskDrawer({
  lodges,
  defaultLodge,
  authorityChips,
  existingTrip,
  lockedDepartment,
  defaultAuthority,
}: {
  lodges: LodgeLite[];
  defaultLodge: string;
  authorityChips?: string[];
  existingTrip?: ExistingTrip;
  lockedDepartment?: string | null;
  defaultAuthority?: string;
}) {
  const heading = existingTrip ? "Add tasks to this trip" : "Assign trip & tasks";
  const subheading = existingTrip
    ? `New tasks are linked to this trip at ${existingTrip.lodgeName}.`
    : "Log a lodge visit and queue the tasks assigned during it.";
  const [open, setOpen] = useState(false);

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
        {existingTrip ? "Add tasks" : heading}
      </button>

      <div
        className={
          "fixed inset-0 z-50 transition " +
          (open ? "visible" : "invisible pointer-events-none")
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
          aria-labelledby="assign-trip-title"
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
              <h2 id="assign-trip-title" className="text-lg leading-6 sm:text-xl">
                {heading}
              </h2>
              <p className="mt-0.5 text-sm text-sand-500">{subheading}</p>
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
            <AssignTripForm
              lodges={lodges}
              defaultLodge={defaultLodge}
              authorityChips={authorityChips}
              existingTrip={existingTrip}
              lockedDepartment={lockedDepartment}
              defaultAuthority={defaultAuthority}
              onDone={() => setOpen(false)}
            />
          </div>
        </div>
      </div>
    </>
  );
}
