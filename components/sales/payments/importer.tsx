"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ui } from "@/components/ui";
import { rupees } from "@/lib/sales/format";
import { importBookings } from "@/app/(dashboard)/sales/payments/actions";
import type { ImportPreview } from "@/lib/sales/payments/import-sheet";

const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "no date");

// The one-time import of the payments Excel: choose the file, see every booking and every row that
// needs a look, then save. Rows with errors are left out; booking numbers already in LodgeIQ are skipped.
export function PaymentsImporter() {
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState("");
  const [preview, setPreview] = useState<(ImportPreview & { sheets: string[]; sheet: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const read = (name = sheet) =>
    start(async () => {
      setError(null);
      setResult(null);
      if (!file) return setError("Choose the Excel file first.");
      const fd = new FormData();
      fd.set("file", file);
      if (name) fd.set("sheet", name);
      const res = await fetch("/api/sales/payments/import", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) return setError(json.error ?? "The file could not be read.");
      setPreview(json);
      setSheet(json.sheet);
    });

  const save = () =>
    start(async () => {
      if (!preview) return;
      const r = await importBookings(preview.bookings);
      if (r.error) return setError(r.error);
      setResult(`${r.made ?? 0} booking${r.made === 1 ? "" : "s"} imported.${r.skipped?.length ? ` Skipped: ${r.skipped.join(" ")}` : ""}`);
      setPreview(null);
    });

  const errors = preview?.notes.filter((n) => n.level === "error") ?? [];
  const warnings = preview?.notes.filter((n) => n.level === "warning") ?? [];
  return (
    <div className="space-y-4">
      <div className={`${ui.card} flex flex-wrap items-end gap-3 p-4`}>
        <label className="min-w-0 flex-1">
          <span className={ui.label}>The payments Excel (.xlsx)</span>
          <input type="file" accept=".xlsx" className="block w-full text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setSheet(""); }} />
        </label>
        <button type="button" className={ui.btnPrimary} disabled={pending || !file} onClick={() => read()}>{pending ? "Reading..." : "Read the file"}</button>
      </div>
      {error && <p className={ui.alertError}>{error}</p>}
      {result && (
        <p className={ui.alertSuccess}>
          {result} <Link href="/sales/payments" className="font-semibold underline">Open Payments</Link>
        </p>
      )}
      {preview && (
        <>
          {preview.sheets.length > 1 && (
            <label className="block max-w-xs">
              <span className={ui.label}>Sheet</span>
              <select className={`${ui.select} w-full`} value={sheet} onChange={(e) => read(e.target.value)}>
                {preview.sheets.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
          <p className="text-sm text-sand-600">
            {preview.rowsRead} rows read: <b>{preview.bookings.length}</b> bookings ({preview.bookings.reduce((t, b) => t + b.lines.length, 0)} lodge bookings) to import, {errors.length} rows left out, {warnings.length} things to check. The same guest within 45 days is one booking.
          </p>
          {(errors.length > 0 || warnings.length > 0) && (
            <div className={`${ui.card} max-h-72 overflow-y-auto p-3 text-sm`}>
              <ul className="space-y-1">
                {[...errors, ...warnings].sort((a, b) => a.row - b.row).map((n, k) => (
                  <li key={k} className={n.level === "error" ? "text-error" : "text-warning"}>Row {n.row}: {n.text}</li>
                ))}
              </ul>
            </div>
          )}
          <div className={`${ui.card} overflow-x-auto`}>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                  <th className="px-3 py-2">Guest</th>
                  <th className="px-3 py-2">Lodge bookings</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2">Payments</th>
                </tr>
              </thead>
              <tbody>
                {preview.bookings.map((b, k) => (
                  <tr key={k} className="border-t border-sand-200 align-top">
                    <td className="px-3 py-2 font-medium">{b.guest_name}</td>
                    <td className="px-3 py-2 text-xs">
                      {b.lines.map((l) => (
                        <div key={l.row}>{l.booking_no ?? "-"} {l.lodge_name && `(${l.lodge_name})`} {dmy(l.check_in)} - {dmy(l.check_out)}, {l.rooms} rm, {l.nights} n</div>
                      ))}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{rupees(b.lines.reduce((t, l) => t + l.room_amount + l.safari_amount + l.transfer_amount + l.other_amount, 0))}</td>
                    <td className="tabular px-3 py-2 text-xs">
                      {b.lines.flatMap((l) => l.payments).map((p, i) => (
                        <div key={i}>{rupees(p.amount)} {p.paid_on ? dmy(p.paid_on) : p.note ?? "no date"}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className={ui.btnPrimary} disabled={pending || !preview.bookings.length} onClick={save}>
            {pending ? "Importing..." : `Import ${preview.bookings.length} bookings`}
          </button>
        </>
      )}
    </div>
  );
}
