"use client";

import { useState } from "react";
import {
  computeDerived,
  getPath,
  groupFields,
  sectionsForLodge,
  setDeep,
  splitTitle,
  type ArrayBlock,
  type ArrayCol,
  type Field,
} from "@/lib/monthly";
import { SectionNav } from "@/components/section-nav";

const inputCls =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-olive-600 focus:ring-2 focus:ring-gold-500 disabled:bg-sand-50 disabled:text-sand-500";
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
function normalize(initial: Data, lodgeName: string): Data {
  const d = clone(initial);
  for (const sec of sectionsForLodge(lodgeName)) {
    for (const b of sec.arrays ?? []) {
      if (!b.dynamic) continue;
      let arr = (d[b.path] as unknown[]) ?? [];
      // Prefill from seed rows (labels) when the block is empty.
      if (arr.length === 0 && Array.isArray(b.seed)) {
        arr = b.seed.map((r) => ({ ...r }));
      }
      const min = b.minRows ?? 1;
      while (arr.length < min) arr.push({});
      d[b.path] = arr;
    }
  }
  return computeDerived(d);
}

export function MonthlyForm({
  initialData,
  locked,
  admin,
  lodge,
  lodgeName,
  month,
  saveDraft,
  submitReport,
}: {
  initialData: Data;
  locked: boolean;
  admin: boolean;
  lodge: string;
  lodgeName: string;
  month: string;
  saveDraft: (fd: FormData) => Promise<void>;
  submitReport: (fd: FormData) => Promise<void>;
}) {
  const [data, setData] = useState<Data>(() => normalize(initialData, lodgeName));
  const sections = sectionsForLodge(lodgeName);

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

      <SectionNav
        sections={sections.map((sec) => ({ key: sec.key, title: sec.title }))}
      />

      <div className="space-y-8">
        {sections.map((sec) => {
          const { number, name } = splitTitle(sec.title);
          return (
            <section
              key={sec.key}
              id={`section-${sec.key}`}
              className="scroll-mt-20 overflow-hidden rounded-xl border border-sand-200 bg-white"
            >
              <h2 className="flex items-center gap-3 border-l-4 border-olive-600 bg-sand-100 px-4 py-3 text-base font-medium text-sand-800">
                {number && (
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-olive-600 text-xs font-semibold text-white">
                    {number}
                  </span>
                )}
                <span className="min-w-0">{name}</span>
              </h2>

              <div className="p-4 sm:p-5">
                {sec.fields && sec.fields.length > 0 && (
                  <div className="mb-5 space-y-5 last:mb-0">
                    {groupFields(sec.fields).map((grp, gi) => (
                      <div
                        key={grp.name ?? "_"}
                        className={
                          grp.name && gi > 0
                            ? "border-t border-sand-200 pt-4"
                            : undefined
                        }
                      >
                        {grp.name && (
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-sand-500">
                            {grp.name}
                          </p>
                        )}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                  // Never render fewer rows than are actually stored, or the
                  // extras would be silently dropped on the next save.
                  const count = b.dynamic
                    ? arr.length
                    : Math.max(b.rows, arr.length);
                  const showRemove = b.dynamic && !locked;
                  const gridStyle = {
                    "--cols": String(b.columns.length),
                  } as React.CSSProperties;
                  return (
                    <div
                      key={b.path}
                      className="mt-5 border-t border-sand-200 pt-4"
                    >
                      <p className="mb-2 text-sm font-medium text-sand-700">
                        {b.label}
                      </p>

                      {/* column headers, md+ only (below md each input carries
                          its own visible label) */}
                      <div className="mb-1 hidden items-start gap-2 md:flex">
                        <div className="array-row flex-1" style={gridStyle}>
                          {b.columns.map((c) => (
                            <span
                              key={c.key}
                              className="truncate text-xs font-medium text-sand-500"
                              title={c.label}
                            >
                              {c.label}
                            </span>
                          ))}
                        </div>
                        {showRemove && (
                          <span className="w-10 shrink-0" aria-hidden="true" />
                        )}
                      </div>

                      <div className="space-y-3 md:space-y-2">
                        {Array.from({ length: count }).map((_, i) => (
                          <div
                            key={i}
                            className="flex items-end gap-2 rounded-lg border border-sand-200 p-3 md:items-start md:rounded-none md:border-0 md:p-0"
                          >
                            <div
                              className="array-row flex-1"
                              style={gridStyle}
                            >
                              {b.columns.map((c) => (
                                <ArrayCell
                                  key={c.key}
                                  c={c}
                                  name={`d:${b.path}[${i}].${c.key}`}
                                  value={cellVal(b.path, i, c.key)}
                                  locked={locked}
                                  onChange={(v) =>
                                    update(`${b.path}[${i}].${c.key}`, v)
                                  }
                                />
                              ))}
                            </div>
                            {showRemove && (
                              <button
                                type="button"
                                onClick={() => removeRow(b, i)}
                                aria-label={`Remove row ${i + 1}`}
                                className="shrink-0 rounded-lg border border-sand-200 px-3 py-2 text-sm text-sand-500 hover:bg-error-bg hover:text-error md:mt-0 md:w-10"
                              >
                                &minus;
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
              </div>
            </section>
          );
        })}
      </div>

      {!locked && (
        <div className="sticky bottom-4 mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-sand-200 bg-white/95 p-4 shadow-sm backdrop-blur">
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
          <span className="w-full text-xs text-sand-500">
            {admin
              ? "As admin you can edit anytime."
              : "Once submitted you can't edit - an admin can reopen it if needed."}
          </span>
        </div>
      )}
    </form>
  );
}

function ArrayCell({
  c,
  name,
  value,
  locked,
  onChange,
}: {
  c: ArrayCol;
  name: string;
  value: string;
  locked: boolean;
  onChange: (v: string) => void;
}) {
  const isComputed = c.computed === true;
  return (
    <label className="block">
      {/* visible below md; from md up the block's header row labels the column */}
      <span className="mb-1 block text-xs text-sand-500 md:hidden">
        {c.label}
      </span>
      <input
        name={name}
        type={inputType(c.type)}
        step={c.type === "number" ? "0.01" : undefined}
        placeholder={c.label}
        aria-label={c.label}
        value={value}
        readOnly={isComputed}
        disabled={locked && !isComputed}
        onChange={isComputed ? undefined : (e) => onChange(e.target.value)}
        className={isComputed ? computedCls : inputCls}
      />
    </label>
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
