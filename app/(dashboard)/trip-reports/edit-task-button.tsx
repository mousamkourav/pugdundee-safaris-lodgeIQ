"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { PRIORITY_LABEL, TASK_PRIORITIES, type Task } from "@/lib/tasks";
import { DepartmentSelect } from "./department-select";
import { updateTask } from "./actions";

const INPUT =
  "w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-100";
const LABEL = "mb-1.5 block text-sm font-medium text-sand-800";

type EditableTask = Pick<
  Task,
  "id" | "title" | "description" | "priority" | "due_date" | "department"
>;

// "Edit details" button + modal, shown only to the task's creator. Only
// the detail fields are editable; photos, status and completion stay as-is.
// The server action re-checks permission; showing the button is not a guard.
export function EditTaskButton({ task }: { task: EditableTask }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<string>(task.priority);
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [department, setDepartment] = useState(task.department ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the latest saved values each time the modal opens.
  function openModal() {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setPriority(task.priority);
    setDueDate(task.due_date ?? "");
    setDepartment(task.department ?? "");
    setError(null);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!title.trim()) return setError("Title is required.");
    if (!department) return setError("Choose a department.");
    setBusy(true);
    try {
      const res = await updateTask({
        task_id: task.id,
        title,
        description,
        priority,
        due_date: dueDate,
        department,
      });
      if (!res.ok) return setError(res.error);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-sm font-medium text-sand-700 transition hover:border-olive-600 hover:text-olive-800"
      >
        <Icon name="edit" className="h-4 w-4" />
        Edit details
      </button>

      {open && (
        <div className="fixed inset-0 z-[60]">
          <div
            className="absolute inset-0 bg-olive-800/35 backdrop-blur-sm"
            onClick={() => !busy && setOpen(false)}
          />
          <form
            onSubmit={save}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`edit-task-${task.id}`}
            className="absolute left-1/2 top-1/2 flex max-h-[92vh] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-overlay"
          >
            <div className="flex items-center gap-3 border-b border-sand-200 bg-sand-100 px-5 py-4">
              <h2 id={`edit-task-${task.id}`} className="min-w-0 flex-1 text-lg leading-6">
                Edit task details
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-lg p-2 text-sand-600 hover:bg-sand-200"
                aria-label="Close"
              >
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div>
                <label className={LABEL}>Task title *</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  required
                  disabled={busy}
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>Instructions</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  maxLength={4000}
                  disabled={busy}
                  className={INPUT}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL}>Department *</label>
                  <DepartmentSelect
                    value={department}
                    onChange={setDepartment}
                    disabled={busy}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL}>Priority *</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    disabled={busy}
                    className={INPUT}
                  >
                    {TASK_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Due date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    disabled={busy}
                    className={INPUT}
                  />
                </div>
              </div>
              {error && (
                <p className="rounded-lg border border-error-border bg-error-bg px-3 py-2 text-sm text-error">
                  {error}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-sand-200 px-5 py-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="inline-flex min-h-10 items-center rounded-lg border border-sand-300 bg-white px-4 py-2 text-sm font-medium text-sand-700 hover:bg-sand-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-olive-600 px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-olive-700 disabled:opacity-60"
              >
                {busy ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
