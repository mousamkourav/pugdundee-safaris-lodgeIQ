// build: 2026-09-02T12:45:16.2472661+05:30
"use client";

import { useMemo, useState } from "react";
import {
  SECTIONS,
  computeDerived,
  getPath,
  setDeep,
  type Field,
  type ArrayBlock,
} from "@/lib/monthly";

const inputCls =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500 disabled:bg-sand-50 disabled:text-sand-500";
const computedCls =
  "w-full rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm font-medium text-sand-700 outline-none";

function inputType(t: string): string {
  if (t === "number" || t === "rating") return "number";
  if (t === "date") return "date";
  return "text";
}

type Data = Record<string, unknown>;

function clone(d: Data): Data {
  return JSON.parse(JSON.stringify(d ?? {}));
}

// Make sure every dynamic block starts with at least its minimum rows so the
// controlled inputs have somewhere to write.
function normalize(initial: Data): Data {
  const d = clone(initial);
  for (const sec of SECTIONS) {
    for (const b of sec.arrays ?? []) {
      if (!b.dynamic) continue;
      const arr = (d[b.path] as unknown[]) ?? [];
      const min = b.minRows ?? 1;
      while (arr.length < min) arr.push({});
      d[b.path] = arr;
    }
  }
  return computeDerived(d);
}

type FieldGroup = { name: string | null; fields: Field[] };
// Split a section's fields into ordered subsection groups by their `group` tag.
// Fields with no group fall into a single unnamed group, preserving order.
function groupFields(fields: Field[]): FieldGroup[] {
  const groups: FieldGroup[] = [];
  let current: FieldGroup | null = null;
  for (const f of fields) {
    const name = f.group ?? null;
    if (!current || current.name !== name) {
      current = { name, fields: [] };
      groups.push(current);
    }
    current.fields.push(f);
  }
  return groups;
}

export function MonthlyForm({
  initialData,
  locked,
  admin,
  lodge,
  month,
  saveDraft,
  submitReport,
}: {
  initialData: Data;
  locked: boolean;
  admin: boolean;
  lodge: string;
  month: string;
  saveDraft: (fd: FormData) => Promise<void>;
  submitReport: (fd: FormData) => Promise<void>;
}) {
  const [data, setData] = useState<Data>(() => normalize(initialData));

  function update(path: string, value: string) {
    setData((prev) => {
      const next = clone(prev);
      setDeep(next, path, value);
      return computeDerived(next);
    });
  }

  function addRow(block: ArrayBlock) {
    setData((prev) => {
      const next = clone(prev);
      const arr = ((next[block.path] as unknown[]) ?? []).slice();
      arr.push({});
      next[block.path] = arr;
      return next;
    });
  }

  function removeRow(block: ArrayBlock, i: number) {
    setData((prev) => {
      const next = clone(prev);
      const arr = ((next[block.path] as unknown[]) ?? []).slice();
      arr.splice(i, 1);
      const min = block.minRows ?? 1;
      while (arr.length < min) arr.push({});
      next[block.path] = arr;
      return next;
    });
  }

  const cellVal = (path: string, i: number, key: string): string => {
    const arr = (data[path] as Array<Record<string, unknown>>) ?? [];
    const v = arr[i]?.[key];
    return v === undefined || v === null ? "" : String(v);
  };

  return (
    <form action={saveDraft}>
      <input type="hidden" name="lodge_id" value={lodge} />
      <input type="hidden" name="month" value={month} />

      <div className="space-y-6">
        {SECTIONS.map((sec) => (
          <section
            key={sec.key}
            className="rounded-xl border border-sand-200 bg-white p-5"
          >
            <h2 className="mb-4 text-base">{sec.title}</h2>

            {sec.fields && sec.fields.length > 0 && (
              <div className="mb-4 space-y-5">
                {groupFields(sec.fields).map((grp) => (
                  <div key={grp.name ?? "_"}>
                    {grp.name && (
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">
                        {grp.name}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {grp.fields.map((f) => (
                        <ScalarField
                          key={f.path}
                          f={f}
                          value={
                            getPath(data, f.path) === undefined ||
                            getPath(data, f.path) === null
                              ? ""
                              : String(getPath(data, f.path))
                          }
                          locked={locked}
                          onChange={(v) => update(f.path, v)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {sec.arrays?.map((b) => {
              const arr = (data[b.path] as unknown[]) ?? [];
              const count = b.dynamic ? arr.length : b.rows;
              return (
                <div key={b.path} className="mb-4 last:mb-0">
                  <p className="mb-2 text-sm font-medium text-sand-700">
                    {b.label}
                  </p>
                  <div className="space-y-2">
                    {Array.from({ length: count }).map((_, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                          {b.columns.map((c) => (
                            <input
                              key={c.key}
                              name={`d:${b.path}[${i}].${c.key}`}
                              type={inputType(c.type)}
                              step={c.type === "number" ? "0.01" : undefined}
                              placeholder={c.label}
                              value={cellVal(b.path, i, c.key)}
                              readOnly={c.computed === true}
                              disabled={locked && c.computed !== true}
                              onChange={
                                c.computed === true
                                  ? undefined
                                  : (e) =>
                                      update(`${b.path}[${i}].${c.key}`, e.target.value)
                              }
                              className={c.computed === true ? computedCls : inputCls}
                            />
                          ))}
                        </div>
                        {b.dynamic && !locked && (
                          <button
                            type="button"
                            onClick={() => removeRow(b, i)}
                            aria-label="Remove row"
                            className="mt-0.5 shrink-0 rounded-lg border border-sand-200 px-2.5 py-2 text-sm text-sand-500 hover:bg-error-bg hover:text-error"
                          >
                            −
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {b.dynamic && !locked && (
                    <button
                      type="button"
                      onClick={() => addRow(b)}
                      className="mt-2 rounded-lg border border-sand-200 px-3 py-1.5 text-sm text-sand-700 hover:bg-sand-50"
                    >
                      + Add {b.label.toLowerCase()}
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      {!locked && (
        <div className="sticky bottom-4 mt-6 flex gap-3 rounded-xl border border-sand-200 bg-white/95 p-4 shadow-sm backdrop-blur">
          <button
            formAction={saveDraft}
            className="rounded-lg border border-sand-200 px-5 py-2 text-sm font-medium text-sand-700 hover:bg-sand-50"
          >
            Save draft
          </button>
          <button
            formAction={submitReport}
            className="rounded-lg bg-olive-600 px-5 py-2 text-sm font-medium text-white hover:bg-olive-700"
          >
            {admin ? "Save & mark submitted" : "Submit (locks report)"}
          </button>
          <span className="self-center text-xs text-sand-500">
            {admin
              ? "As admin you can edit anytime."
              : "Once submitted you can't edit — an admin can reopen it if needed."}
          </span>
        </div>
      )}
    </form>
  );
}

function ScalarField({
  f,
  value,
  locked,
  onChange,
}: {
  f: Field;
  value: string;
  locked: boolean;
  onChange: (v: string) => void;
}) {
  const isComputed = f.computed === true;
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-sand-500">{f.label}</span>
      <input
        name={`d:${f.path}`}
        type={inputType(f.type)}
        step={
          f.type === "rating" ? "0.1" : f.type === "number" ? "0.01" : undefined
        }
        value={value}
        readOnly={isComputed}
        disabled={locked && !isComputed}
        tabIndex={isComputed ? -1 : undefined}
        onChange={isComputed ? undefined : (e) => onChange(e.target.value)}
        className={isComputed ? computedCls : inputCls}
      />
    </label>
  );
}
