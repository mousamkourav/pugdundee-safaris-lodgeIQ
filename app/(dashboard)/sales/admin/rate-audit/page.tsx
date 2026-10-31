import Link from "next/link";
import { ui } from "@/components/ui";
import { AUDIT_STATUS_LABEL, type AuditStatus } from "@/lib/sales/master/rate-audit";
import { loadRateAudit } from "@/lib/sales/master/rate-audit-data";
import { RATE_CARD_QUESTIONS } from "@/lib/sales/master/rate-card";

// Master data checked against the owner's rate documents (lib/sales/master/rate-card.ts):
// every difference first, then what is OK, then the questions the documents leave open.
// Sales admins only (the admin layout checks).
const ORDER: AuditStatus[] = ["missing", "different", "dates", "gst", "not found", "ok"];
const TONE: Record<AuditStatus, string> = {
  missing: "bg-error-bg text-error",
  different: "bg-gold-50 text-gold-800",
  dates: "bg-gold-50 text-gold-800",
  gst: "bg-gold-50 text-gold-800",
  "not found": "bg-sand-100 text-sand-600",
  ok: "bg-olive-50 text-olive-700",
};

export default async function RateAuditPage() {
  const { rows, error } = await loadRateAudit();
  const sorted = [...rows].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.source.localeCompare(b.source) || a.item.localeCompare(b.item));
  const count = (s: AuditStatus) => rows.filter((r) => r.status === s).length;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sales/admin" className="text-xs font-medium text-sand-500 hover:text-olive-600">Master data</Link>
        <h1 className="mt-1 text-2xl">Rate audit</h1>
        <p className="mt-1 max-w-3xl text-sm text-sand-500">
          Master data compared with the rate documents for 2026-27: the selling-rate card (road transfers), the partner hotels, and the Ken River Lodge B2B sheet. Also every room rate above Rs 7,500 a night without 18% GST.
          Fix a difference in Master data, or run <code>supabase/sales_rate_card_2026.sql</code> for the transfer card.
        </p>
      </div>

      {error && <p className={ui.alertError}>Could not load: {error}</p>}

      <div className="flex flex-wrap gap-2 text-xs">
        {ORDER.map((s) => (
          <span key={s} className={`rounded-full px-2.5 py-1 font-semibold ${TONE[s]}`}>
            {AUDIT_STATUS_LABEL[s]}: {count(s)}
          </span>
        ))}
      </div>

      <div className={`${ui.card} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                <th className="px-4 py-2">Document</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Document says</th>
                <th className="px-4 py-2">Master data has</th>
                <th className="px-4 py-2">Result</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, k) => (
                <tr key={`${r.source}-${r.item}-${k}`} className="border-t border-sand-100">
                  <td className="px-4 py-2 text-sand-600">{r.source}</td>
                  <td className="px-4 py-2 text-olive-800">{r.item}</td>
                  <td className="tabular px-4 py-2">{r.expected}</td>
                  <td className="tabular px-4 py-2">{r.found}</td>
                  <td className="px-4 py-2">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[r.status]}`}>{AUDIT_STATUS_LABEL[r.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <section className={`${ui.card} p-4`}>
        <h2 className="text-base font-semibold text-olive-800">Questions for the owner</h2>
        <p className="mt-1 text-sm text-sand-500">The documents do not make these clear, so nothing was changed for them.</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-sand-700">
          {RATE_CARD_QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
