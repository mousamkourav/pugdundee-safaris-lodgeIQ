import Link from "next/link";
import { requireSopEditor, loadVersion, fmtDate } from "@/lib/sop/server";
import { loadReadReport } from "@/lib/sop/reads";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";

export const metadata = { title: "Who has read the SOP" };

export default async function SopReadsPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { documentId } = await requireSopEditor();
  const n = Number((await searchParams).v);
  const supabase = await createClient();
  const [{ data }, version] = await Promise.all([
    supabase.from("sop_versions").select("number").eq("document_id", documentId).order("number", { ascending: false }),
    loadVersion(documentId, Number.isInteger(n) && n > 0 ? n : undefined),
  ]);
  const numbers = ((data ?? []) as { number: number }[]).map((r) => r.number);
  if (!version) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl">Who has read the SOP</h1>
        <div className={ui.empty}>Nothing has been published yet.</div>
      </div>
    );
  }
  const rows = await loadReadReport(documentId, version.id);
  const done = rows.filter((r) => r.readAt).length;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Who has read version {version.number}</h1>
          <p className="mt-1 text-sm text-sand-500">
            {done} of {rows.length} have read it. Staff with SOP access are listed (not the super admin).
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <form method="get" className="flex items-end gap-2">
            <label>
              <span className={ui.label}>Version</span>
              <select name="v" defaultValue={version.number} className={ui.select}>
                {numbers.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <button className={ui.btnSecondary}>Show</button>
          </form>
          <a href={`/sop/reads/export?v=${version.number}`} className={ui.btnPrimary}>
            Export to Excel
          </a>
        </div>
      </div>

      {!rows.length ? (
        <div className={ui.empty}>
          Nobody has access yet. <Link href="/sop/access" className="text-olive-700 underline">Give access</Link>.
        </div>
      ) : (
        <div className={`${ui.card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-sand-500">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Lodges</th>
                <th className="px-4 py-2">Read</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-sand-100">
                  <td className="px-4 py-2 font-medium text-sand-700">{r.name}</td>
                  <td className="px-4 py-2">{r.role}</td>
                  <td className="px-4 py-2">{r.lodges || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-2">{r.readAt ? <span className="text-success">Yes, {fmtDate(r.readAt)}</span> : <span className="font-semibold text-error">Not yet</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
