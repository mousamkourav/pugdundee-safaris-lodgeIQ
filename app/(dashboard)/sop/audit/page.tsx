import { requireSopEditor, namesOf, fmtDate } from "@/lib/sop/server";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/auth";
import { ui } from "@/components/ui";

export const metadata = { title: "SOP audit log" };

type Row = { id: number; action: string; detail: Record<string, unknown>; actor: string | null; at: string };

const ACTION: Record<string, string> = {
  import: "Imported from Word",
  publish: "Published",
  restore: "Restored an old version as the draft",
  access_grant: "Gave access",
  access_revoke: "Removed access",
};

export default async function SopAuditPage() {
  const { documentId } = await requireSopEditor();
  const supabase = await createClient();
  const { data } = await supabase.from("sop_audit").select("id, action, detail, actor, at").eq("document_id", documentId).order("at", { ascending: false }).limit(300);
  const rows = (data ?? []) as Row[];
  const names = await namesOf([...rows.map((r) => r.actor), ...rows.map((r) => (typeof r.detail?.user_id === "string" ? r.detail.user_id : null))]);

  const what = (r: Row) => {
    const d = r.detail ?? {};
    switch (r.action) {
      case "import":
        return `${d.sections ?? "?"} sections${d.file ? ` from ${d.file}` : ""}${d.linesToCheck ? `, ${d.linesToCheck} lines to check` : ""}`;
      case "publish":
        return `Version ${d.version}: ${d.note ?? ""}`;
      case "restore":
        return `Version ${d.from_version} (${d.sections ?? "?"} sections)`;
      default:
        return typeof d.user_id === "string" ? names.get(d.user_id) ?? "a person" : typeof d.role === "string" ? `All ${ROLE_LABELS[d.role as Role] ?? d.role}s` : "";
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <h1 className="text-2xl">SOP audit log</h1>
      {!rows.length ? (
        <div className={ui.empty}>Nothing yet.</div>
      ) : (
        <div className={`${ui.card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-sand-500">
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">What</th>
                <th className="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-sand-100 align-top">
                  <td className="whitespace-nowrap px-4 py-2">{fmtDate(r.at)}</td>
                  <td className="px-4 py-2">{(r.actor && names.get(r.actor)) || "-"}</td>
                  <td className="px-4 py-2 font-medium text-sand-700">{ACTION[r.action] ?? r.action}</td>
                  <td className="px-4 py-2">{what(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
