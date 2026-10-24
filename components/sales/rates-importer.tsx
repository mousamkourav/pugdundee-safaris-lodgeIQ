"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { applyRatesImport, type ApplyResult } from "@/app/(dashboard)/sales/admin/import-rates/actions";
import type { ImportPreview } from "@/lib/sales/master/rates-data";

const pctList = (rows: { label?: string; pct: number; days_before_arrival?: number | null; min_days?: number; max_days?: number | null }[]) =>
  rows
    .map((r) =>
      r.label !== undefined
        ? `${r.label} ${r.pct}% ${r.days_before_arrival == null ? "at booking" : `${r.days_before_arrival} days before`}`
        : `${r.min_days}-${r.max_days ?? "more"} days: ${r.pct}%`
    )
    .join("; ");

export function RatesImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ApplyResult | null>(null);
  const [applying, start] = useTransition();

  async function read() {
    if (!file) return;
    setError(null);
    setPreview(null);
    setDone(null);
    setReading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/sales/rates-import", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({ error: "The server answered in an unexpected way." }));
      if (!res.ok || body.error) setError(body.error ?? "The file could not be read.");
      else setPreview(body as ImportPreview);
    } catch {
      setError("Could not reach the server. Check the connection and try again.");
    } finally {
      setReading(false);
    }
  }

  function apply() {
    if (!preview) return;
    start(async () => {
      try {
        const res = await applyRatesImport({
          changes: preview.changes.map((c) => ({ entity: c.entity, id: c.id, field: c.field, old: c.old, new: c.new })),
          payment: preview.payment?.new ?? null,
          cancellation: preview.cancellation?.new ?? null,
        });
        if (res.error) setError(res.error);
        else {
          setDone(res);
          setPreview(null);
          setFile(null);
        }
      } catch {
        setError("Could not reach the server. Nothing may have been saved; read the file again to check.");
      }
    });
  }

  const total = (preview?.changes.length ?? 0) + (preview?.payment ? 1 : 0) + (preview?.cancellation ? 1 : 0);
  const sheets = preview ? [...new Set(preview.changes.map((c) => c.sheet))] : [];

  return (
    <div className="space-y-4">
      <section className={`${ui.card} space-y-3 p-5`}>
        <label className="block">
          <span className={ui.label}>Excel file (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-olive-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-olive-700"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setDone(null);
              setError(null);
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={ui.btnPrimary} disabled={!file || reading} onClick={read}>
            <Icon name="fileSearch" className="h-4 w-4" />
            {reading ? "Reading..." : "Show the changes"}
          </button>
          <a href="/api/sales/rates-export" className={ui.btnSecondary}>
            <Icon name="fileText" className="h-4 w-4" />
            Export all rates (Excel)
          </a>
        </div>
      </section>

      {error && <p className={ui.alertError}>{error}</p>}

      {done && (
        <div className={`${ui.alertSuccess} space-y-1`}>
          <p className="font-semibold">
            {done.applied ? `${done.applied} change${done.applied === 1 ? "" : "s"} saved.` : "Nothing was saved."} New quotes use the new rates; saved quotes keep theirs.
          </p>
          {!!done.skipped?.length && (
            <ul className="list-disc pl-5 text-warning">
              {done.skipped.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
          <Link href="/sales/admin" className="font-semibold underline">Back to Master data</Link>
        </div>
      )}

      {preview && (
        <section className="space-y-3">
          {preview.notes.map((n, i) => <p key={i} className={`${ui.alertWarning} text-sm`}>{n}</p>)}
          {preview.problems.length > 0 && (
            <div className={`${ui.alertError} text-sm`}>
              <p className="font-semibold">{preview.problems.length} cell{preview.problems.length === 1 ? "" : "s"} could not be read and will not be imported:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {preview.problems.slice(0, 50).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
              {preview.problems.length > 50 && <p className="mt-1">...and {preview.problems.length - 50} more.</p>}
            </div>
          )}

          {total === 0 ? (
            <div className={ui.empty}>No changes: every value in the file is the same as in LodgeIQ.</div>
          ) : (
            <div className={`${ui.card} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand-200 px-4 py-3">
                <p className="font-semibold text-olive-800">
                  {total} change{total === 1 ? "" : "s"} to apply
                </p>
                <button type="button" className={ui.btnPrimary} disabled={applying} onClick={apply}>
                  <Icon name="check" className="h-4 w-4" />
                  {applying ? "Saving..." : `Apply ${total} change${total === 1 ? "" : "s"}`}
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                      <th className="px-4 py-2">Item</th>
                      <th className="px-4 py-2">Field</th>
                      <th className="px-4 py-2 text-right">Now</th>
                      <th className="px-4 py-2" aria-label="becomes" />
                      <th className="px-4 py-2">New</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheets.map((sheet) => (
                      <SheetRows key={sheet} sheet={sheet} rows={preview.changes.filter((c) => c.sheet === sheet)} />
                    ))}
                    {preview.payment && (
                      <tr className="border-t border-sand-200 align-top">
                        <td className="px-4 py-2 font-medium text-olive-800">Payment schedule</td>
                        <td className="px-4 py-2">Instalments</td>
                        <td className="px-4 py-2 text-right text-sand-500 line-through">{pctList(preview.payment.old) || "(empty)"}</td>
                        <td className="px-2 py-2 text-sand-400">&rarr;</td>
                        <td className="px-4 py-2 font-semibold">{pctList(preview.payment.new)}</td>
                      </tr>
                    )}
                    {preview.cancellation && (
                      <tr className="border-t border-sand-200 align-top">
                        <td className="px-4 py-2 font-medium text-olive-800">Cancellation charges</td>
                        <td className="px-4 py-2">Charges</td>
                        <td className="px-4 py-2 text-right text-sand-500 line-through">{pctList(preview.cancellation.old) || "(empty)"}</td>
                        <td className="px-2 py-2 text-sand-400">&rarr;</td>
                        <td className="px-4 py-2 font-semibold">{pctList(preview.cancellation.new)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function SheetRows({ sheet, rows }: { sheet: string; rows: ImportPreview["changes"] }) {
  return (
    <>
      <tr className="border-t border-sand-300 bg-sand-50">
        <td colSpan={5} className="px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-sand-600">
          {sheet} &middot; {rows.length} change{rows.length === 1 ? "" : "s"}
        </td>
      </tr>
      {rows.map((c, i) => (
        <tr key={`${c.id}-${c.field}-${i}`} className="border-t border-sand-100 align-top">
          <td className="px-4 py-2 text-olive-800">{i > 0 && rows[i - 1].id === c.id ? "" : c.row}</td>
          <td className="px-4 py-2">{c.label}</td>
          <td className="tabular px-4 py-2 text-right text-sand-500 line-through">{c.oldText}</td>
          <td className="px-2 py-2 text-sand-400">&rarr;</td>
          <td className="tabular px-4 py-2 font-semibold text-olive-800">{c.newText}</td>
        </tr>
      ))}
    </>
  );
}
