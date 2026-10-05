"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import type { ActionResult, FieldDef } from "@/lib/sales/master/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isWide = (f: FieldDef) =>
  f.wide || f.type === "textarea" || f.type === "json" || f.type === "refs" || f.type === "multiselect" || f.type === "weekdays";

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function Field({ f, value }: { f: FieldDef; value: unknown }) {
  const id = `f_${f.name}`;
  const common = { id, name: f.name, required: f.required, placeholder: f.placeholder };
  const str = value === null || value === undefined ? "" : String(value);

  let input: React.ReactNode;
  switch (f.type) {
    case "textarea":
      input = <textarea {...common} rows={4} defaultValue={str} className={ui.input} />;
      break;
    case "json":
      input = (
        <textarea
          {...common}
          rows={6}
          spellCheck={false}
          defaultValue={value === null || value === undefined ? "" : JSON.stringify(value, null, 2)}
          className={`${ui.input} font-mono text-xs`}
        />
      );
      break;
    case "int":
      input = <input {...common} type="number" step="1" defaultValue={str} className={ui.input} />;
      break;
    case "number":
      input = <input {...common} type="number" step="any" defaultValue={str} className={ui.input} />;
      break;
    case "money":
      input = <input {...common} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={str} className={`${ui.input} tabular`} />;
      break;
    case "date":
      input = <input {...common} type="date" defaultValue={str.slice(0, 10)} className={ui.input} />;
      break;
    case "time":
      input = <input {...common} type="time" defaultValue={str.slice(0, 5)} className={ui.input} />;
      break;
    case "bool":
      return (
        <label htmlFor={id} className="flex items-start gap-3 rounded-lg border border-sand-200 bg-white p-3 sm:col-span-1">
          <input id={id} name={f.name} type="checkbox" defaultChecked={!!value} className="mt-0.5 h-4 w-4" />
          <span>
            <span className="block text-sm font-medium text-olive-800">{f.label}</span>
            {f.help && <span className="mt-0.5 block text-xs text-sand-500">{f.help}</span>}
          </span>
        </label>
      );
    case "select":
    case "ref":
      input = (
        <select {...common} defaultValue={str} className={`${ui.select} w-full`}>
          {!f.required && <option value="">- None -</option>}
          {f.required && str === "" && <option value="" disabled>Choose...</option>}
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case "multiselect":
    case "refs": {
      const sel = asArray(value);
      input = (f.options ?? []).length ? (
        <div className="grid max-h-56 gap-1.5 overflow-y-auto rounded-lg border border-sand-200 bg-white p-3 sm:grid-cols-2">
          {(f.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={f.name} value={o.value} defaultChecked={sel.includes(o.value)} className="h-4 w-4" />
              {o.label}
            </label>
          ))}
        </div>
      ) : (
        <p className="text-sm text-sand-500">Nothing to choose from yet.</p>
      );
      break;
    }
    case "weekdays": {
      const sel = asArray(value);
      input = (
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1.5 rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm">
              <input type="checkbox" name={f.name} value={i} defaultChecked={sel.includes(String(i))} className="h-4 w-4" />
              {d}
            </label>
          ))}
        </div>
      );
      break;
    }
    case "tags":
      input = <input {...common} type="text" defaultValue={asArray(value).join(", ")} className={ui.input} />;
      break;
    default:
      input = <input {...common} type="text" defaultValue={str} className={ui.input} />;
  }

  return (
    <div className={isWide(f) ? "sm:col-span-2" : ""}>
      <label htmlFor={id} className={ui.label}>
        {f.label}
        {f.required && <span className="text-error"> *</span>}
      </label>
      {input}
      {f.help && <p className="mt-1 text-xs text-sand-500">{f.help}</p>}
    </div>
  );
}

export function MasterForm({
  fields,
  values,
  action,
  deleteAction,
  deleteWarning,
  backHref,
  afterSaveHref,
  submitLabel = "Save",
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  action: (fd: FormData) => Promise<ActionResult>;
  deleteAction?: () => Promise<ActionResult>;
  deleteWarning?: string;
  backHref: string;
  afterSaveHref?: string; // where to go after saving; omit to stay and show "Saved"
  submitLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // onSubmit + manual call (instead of <form action>) so the inputs keep what
  // the user typed when the server returns an error.
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await action(fd);
      if (res.error) {
        setError(res.error);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (afterSaveHref) router.push(afterSaveHref);
      else setSaved(true);
      router.refresh();
    });
  }

  function onDelete() {
    if (!deleteAction) return;
    const msg = (deleteWarning ? deleteWarning + "\n\n" : "") + "Delete this permanently?";
    if (!window.confirm(msg)) return;
    setError(null);
    start(async () => {
      const res = await deleteAction();
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(backHref);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <p className={ui.alertError}>{error}</p>}
      {saved && <p className={ui.alertSuccess}>Saved.</p>}

      <div className={`${ui.card} grid gap-5 p-5 sm:grid-cols-2 sm:p-6`}>
        {fields.map((f) => (
          <Field key={f.name} f={f} value={values[f.name]} />
        ))}
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {deleteAction && (
            <button type="button" onClick={onDelete} disabled={pending} className={ui.btnDangerOutline}>
              Delete
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Link href={backHref} className={ui.btnSecondary}>
            Cancel
          </Link>
          <button type="submit" disabled={pending} className={ui.btnPrimary}>
            {pending ? "Saving..." : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
