"use client";

import { useEffect, useState } from "react";
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
  type Section,
} from "@/lib/monthly";

const inputCls =
  "w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-50 disabled:text-sand-500";
const computedCls =
  "w-full rounded-lg border border-sand-200 bg-sand-100 px-3.5 py-2.5 text-sm font-semibold text-olive-800 tabular outline-none";

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

// ---- Display-only progress (never saved, never affects what is submitted) ----

type SecStatus = "complete" | "partial" | "empty";

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

// A section is "complete" when every hand-entered field has a value, "partial"
// when anything has been typed. Array blocks count as touched once any numeric
// cell has a value (seed rows prefill labels, so text cells would be noisy).
function sectionStatus(sec: Section, data: Data): SecStatus {
  const inputs = (sec.fields ?? []).filter((f) => !f.computed);
  const done = inputs.filter((f) => filled(getPath(data, f.path))).length;
  const arrayTouched = (sec.arrays ?? []).some((b) => {
    const rows = (data[b.path] as Array<Record<string, unknown>>) ?? [];
    const numeric = b.columns.filter(
      (c) => !c.computed && (c.type === "number" || c.type === "rating")
    );
    return rows.some((r) => numeric.some((c) => filled(r?.[c.key])));
  });
  if (inputs.length > 0 && done === inputs.length) return "complete";
  if (inputs.length === 0 && arrayTouched) return "complete";
  if (done > 0 || arrayTouched) return "partial";
  return "empty";
}

const STATUS_UI: Record<SecStatus, { label: string; pill: string; dot: string }> = {
  complete: {
    label: "Complete",
    pill: "border-success-border bg-success-bg text-success",
    dot: "bg-success",
  },
  partial: {
    label: "In progress",
    pill: "border-pending-border bg-pending-bg text-warning",
    dot: "bg-pending",
  },
  empty: {
    label: "Pending input",
    pill: "border-sand-200 bg-sand-100 text-sand-500",
    dot: "bg-sand-300",
  },
};

const pad = (n: string | null, i: number) => {
  const v = n ?? String(i + 1);
  return /^\d$/.test(v) ? `0${v}` : v;
};

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
  const [activeKey, setActiveKey] = useState<string | null>(sections[0]?.key ?? null);

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

  // Highlight the section currently in view in the manifest.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = sections
      .map((s) => document.getElementById(`section-${s.key}`))
      .filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActiveKey(top.target.id.replace(/^section-/, ""));
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
    // Section list only changes with the lodge, so lodgeName is the real dependency.
  }, [lodgeName]);

  const statuses = sections.map((s) => sectionStatus(s, data));
  const doneCount = statuses.filter((s) => s === "complete").length;
  const pct = sections.length ? Math.round((doneCount / sections.length) * 100) : 0;

  return (
    <form action={saveDraft}>
      <input type="hidden" name="lodge_id" value={lodge} />
      <input type="hidden" name="month" value={month} />

      {/* mobile / tablet: horizontal section strip */}
      <nav
        aria-label="Jump to section"
        className="no-print no-scrollbar sticky top-16 z-10 -mx-4 mb-4 overflow-x-auto border-b border-sand-200 bg-sand-50/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden"
      >
        <ul className="flex min-w-max gap-1.5">
          {sections.map((sec, i) => {
            const { number, name } = splitTitle(sec.title);
            const st = STATUS_UI[statuses[i]];
            const active = activeKey === sec.key;
            return (
              <li key={sec.key}>
                <a
                  href={`#section-${sec.key}`}
                  className={
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition " +
                    (active
                      ? "border-olive-600 bg-olive-600 text-white"
                      : "border-sand-200 bg-white text-sand-700")
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white" : st.dot}`} />
                  <span className="font-semibold">{pad(number, i)}</span>
                  <span className="max-w-[10rem] truncate">{name}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-8">
        {/* desktop: sticky section manifest */}
        <aside className="no-print hidden lg:sticky lg:top-24 lg:block">
          <div className="rounded-xl border border-sand-200 bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Sections manifest</p>
              <span className="text-xs font-medium text-sand-500">{sections.length} steps</span>
            </div>
            <div className="mb-4">
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-sand-600">
                  {doneCount} of {sections.length} complete
                </span>
                <span className="font-semibold text-olive-700 tabular">{pct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-sand-100">
                <div className="h-full rounded-full bg-olive-600 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <ul className="max-h-[calc(100vh-16rem)] space-y-0.5 overflow-y-auto pr-1">
              {sections.map((sec, i) => {
                const { number, name } = splitTitle(sec.title);
                const status = statuses[i];
                const active = activeKey === sec.key;
                return (
                  <li key={sec.key}>
                    <a
                      href={`#section-${sec.key}`}
                      className={
                        "flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] transition " +
                        (active
                          ? "bg-olive-50 font-semibold text-olive-800"
                          : "text-sand-700 hover:bg-sand-50")
                      }
                    >
                      <span
                        className={
                          "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold tabular " +
                          (active
                            ? "border-olive-600 bg-olive-600 text-white"
                            : "border-sand-300 bg-white text-sand-600")
                        }
                      >
                        {pad(number, i)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <StatusMark status={status} />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          {sections.map((sec, si) => {
            const { number, name } = splitTitle(sec.title);
            const st = STATUS_UI[statuses[si]];
            return (
              <section
                key={sec.key}
                id={`section-${sec.key}`}
                className="scroll-mt-32 overflow-hidden rounded-xl border border-sand-200 bg-white shadow-card lg:scroll-mt-24"
              >
                <div className="flex items-start gap-3 border-b border-sand-100 px-4 py-4 sm:px-6">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-olive-600 text-sm font-bold text-white tabular">
                    {pad(number, si)}
                  </span>
                  <h2 className="min-w-0 flex-1 self-center text-base leading-6 sm:text-lg">
                    {name}
                  </h2>
                  <span
                    className={`hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold sm:inline-flex ${st.pill}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                </div>

                <div className="p-4 sm:p-6">
                  {sec.fields && sec.fields.length > 0 && (
                    <div className="mb-6 space-y-6 last:mb-0">
                      {groupFields(sec.fields).map((grp, gi) => (
                        <div
                          key={grp.name ?? "_"}
                          className={
                            grp.name && gi > 0
                              ? "border-t border-sand-100 pt-5"
                              : undefined
                          }
                        >
                          {grp.name && (
                            <p className="mb-3 text-sm font-semibold text-olive-800">
                              {grp.name}
                            </p>
                          )}
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
                        className="mt-6 rounded-xl border border-sand-200 bg-sand-50 p-3 first:mt-0 sm:p-4"
                      >
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-olive-800">{b.label}</p>
                          {b.dynamic && !locked && (
                            <button
                              type="button"
                              onClick={() => addRow(b)}
                              className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-olive-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-olive-700"
                            >
                              + Add {b.label.toLowerCase()}
                            </button>
                          )}
                        </div>

                        {/* column headers, md+ only (below md each input carries
                            its own visible label) */}
                        <div className="mb-1.5 hidden items-start gap-2 md:flex">
                          <div className="array-row flex-1" style={gridStyle}>
                            {b.columns.map((c) => (
                              <span
                                key={c.key}
                                className="truncate text-[11px] font-semibold uppercase tracking-wider text-sand-500"
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
                              className="flex items-end gap-2 rounded-lg border border-sand-200 bg-white p-3 md:items-start md:rounded-none md:border-0 md:bg-transparent md:p-0"
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
                                  className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-sand-200 bg-white text-sand-500 transition hover:border-error-border hover:bg-error-bg hover:text-error md:h-10 md:w-10"
                                >
                                  &minus;
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {!locked && (
        <div className="no-print sticky bottom-0 z-20 -mx-4 mt-8 border-t border-sand-200 bg-white px-4 py-3 shadow-bar sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-olive-800">
                <span className="h-2 w-2 rounded-full bg-gold-500" aria-hidden="true" />
                {doneCount} of {sections.length} sections complete
              </p>
              <p className="text-xs text-sand-500">
                {admin
                  ? "As admin you can edit anytime."
                  : "Once submitted you can't edit - an admin can reopen it if needed."}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                formAction={saveDraft}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-sand-300 bg-white px-5 py-2 text-sm font-medium text-sand-700 transition hover:border-sand-500 hover:bg-sand-100 sm:min-h-10 sm:flex-none"
              >
                Save draft
              </button>
              <button
                formAction={submitReport}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-olive-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-olive-700 active:bg-olive-800 sm:min-h-10 sm:flex-none"
              >
                {admin ? "Save & mark submitted" : "Submit (locks report)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

function StatusMark({ status }: { status: SecStatus }) {
  if (status === "complete") {
    return (
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-success" aria-label="Complete">
        <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.15" />
        <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "partial") {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-pending" aria-label="In progress" />;
  }
  return <span className="h-2 w-2 shrink-0 rounded-full border border-sand-300" aria-label="Pending input" />;
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
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-sand-500 md:hidden">
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
      <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sand-500">
        {f.label}
        {isComputed && (
          <span className="rounded bg-olive-50 px-1 py-px text-[9px] font-bold tracking-wider text-olive-600">
            AUTO
          </span>
        )}
      </span>
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
