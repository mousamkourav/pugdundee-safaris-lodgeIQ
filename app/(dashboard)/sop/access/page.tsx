import Link from "next/link";
import { requireSopEditor, loadVersion, namesOf, fmtDay, fmtDate, type VersionRow } from "@/lib/sop/server";
import { loadReadReport } from "@/lib/sop/reads";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/auth";
import { audience, isSopEditor, type AccessRow, type Person } from "@/lib/sop/access";
import { ui } from "@/components/ui";
import { GrantForm, RemoveButton, AskReadButton, RestoreButton } from "./access-form";

export const metadata = { title: "SOP access & reading" };

type AuditRow = { id: number; action: string; detail: Record<string, unknown>; actor: string | null; at: string };
const ACTION: Record<string, string> = {
  import: "Imported from Word",
  publish: "Went live",
  restore: "Restored an old version",
  access_grant: "Gave access",
  access_revoke: "Removed access",
  ask_read: "Asked staff to read",
};

// Super admin only: who can view the SOP, who has read the latest update, and (folded) the
// version history with restore and the audit log.
export default async function SopAccessPage() {
  const { documentId } = await requireSopEditor();
  const supabase = await createClient();
  const [{ data: rows }, { data: profiles }, { data: vrows }, { data: arows }, live] = await Promise.all([
    supabase.from("sop_access").select("id, user_id, role, granted_at").eq("document_id", documentId).order("granted_at"),
    supabase.from("profiles").select("id, full_name, role, status").order("full_name"),
    supabase.from("sop_versions").select("id, number, note, published_at, published_by, ask_read").eq("document_id", documentId).order("number", { ascending: false }).limit(200),
    supabase.from("sop_audit").select("id, action, detail, actor, at").eq("document_id", documentId).order("at", { ascending: false }).limit(300),
    loadVersion(documentId),
  ]);
  const access = (rows ?? []) as (AccessRow & { id: string; granted_at: string })[];
  const people = (profiles ?? []) as Person[];
  const versions = (vrows ?? []) as VersionRow[];
  const audit = (arows ?? []) as AuditRow[];
  const nameOf = new Map(people.map((p) => [p.id, p.full_name || "(no name)"]));
  const label = (r: string) => ROLE_LABELS[r as Role] ?? r;
  const byRole = access.filter((a) => a.role);
  const byPerson = access.filter((a) => a.user_id);
  const choosablePeople = people
    .filter((p) => (p.status ?? "active") === "active" && !isSopEditor(p.role) && !byPerson.some((a) => a.user_id === p.id))
    .map((p) => ({ id: p.id, label: `${p.full_name || "(no name)"}${p.role ? ` - ${label(p.role)}` : ""}` }));
  const choosableRoles = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => !isSopEditor(r) && !byRole.some((a) => a.role === r)).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const total = audience(people, access).length;

  // reading: the latest version staff were asked to read
  const asked = versions.find((v) => v.ask_read) ?? null;
  const report = asked ? await loadReadReport(documentId, asked.id) : [];
  const done = report.filter((r) => r.readAt).length;
  const names = await namesOf([...versions.map((v) => v.published_by), ...audit.map((a) => a.actor), ...audit.map((a) => (typeof a.detail?.user_id === "string" ? a.detail.user_id : null))]);

  const what = (r: AuditRow) => {
    const d = r.detail ?? {};
    switch (r.action) {
      case "import":
        return `${d.sections ?? "?"} sections${d.file ? ` from ${d.file}` : ""}${d.linesToCheck ? `, ${d.linesToCheck} lines to check` : ""}`;
      case "publish":
        return `Version ${d.version}: ${d.note ?? ""}${d.ask_read ? " (staff asked to read)" : ""}`;
      case "restore":
        return `Version ${d.from_version}`;
      case "ask_read":
        return `Version ${d.version}`;
      default:
        return typeof d.user_id === "string" ? names.get(d.user_id) ?? "a person" : typeof d.role === "string" ? `All ${label(d.role)}s` : "";
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <Link href="/sop" className="text-sm font-medium text-olive-700 hover:underline">
          &larr; SOP
        </Link>
        <h1 className="mt-1 text-2xl">Access &amp; reading</h1>
      </div>

      {/* ---------------- who can view */}
      <section className={`${ui.card} space-y-4 p-4 sm:p-6`}>
        <div>
          <h2 className="text-lg">Who can view the SOP</h2>
          <p className="mt-1 text-sm text-sand-500">
            A person, or everyone with a role: either is enough. Removing access takes effect on their next click. {total} people can view it now (plus the super admin).
          </p>
        </div>
        <GrantForm people={choosablePeople} roles={choosableRoles} />
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-sand-500">By role</h3>
            {!byRole.length ? (
              <p className="mt-2 text-sm text-sand-500">No roles yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-sand-100">
                {byRole.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-semibold text-sand-700">All {label(a.role!)}s</span>
                      <span className="block text-xs text-sand-500">since {fmtDay(a.granted_at)}</span>
                    </span>
                    <RemoveButton id={a.id} what={`all ${label(a.role!)}s`} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-sand-500">By person</h3>
            {!byPerson.length ? (
              <p className="mt-2 text-sm text-sand-500">No one yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-sand-100">
                {byPerson.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>
                      <span className="font-semibold text-sand-700">{nameOf.get(a.user_id!) ?? "(removed account)"}</span>
                      <span className="block text-xs text-sand-500">since {fmtDay(a.granted_at)}</span>
                    </span>
                    <RemoveButton id={a.id} what={nameOf.get(a.user_id!) ?? "this person"} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ---------------- who has read */}
      <section id="reading" className={`${ui.card} space-y-4 p-4 sm:p-6`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg">Who has read the latest update</h2>
            <p className="mt-1 text-sm text-sand-500">
              {asked
                ? `Version ${asked.number} (${fmtDay(asked.published_at)}): ${done} of ${report.length} have read it.${live && live.number !== asked.number ? ` The SOP has changed since (now version ${live.number}) without asking staff to read.` : ""}`
                : "You have not asked staff to read the SOP yet. Tick \"Ask staff to read this update\" when you save, or use the button."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {asked && (
              <a href="/sop/access/export" className={ui.btnSecondary}>
                Export to Excel
              </a>
            )}
            {live && (!asked || live.number !== asked.number) && <AskReadButton version={live.number} />}
          </div>
        </div>
        {asked &&
          (!report.length ? (
            <p className="text-sm text-sand-500">Nobody has access yet.</p>
          ) : (
            <div className="-mx-4 overflow-x-auto sm:mx-0">
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
                  {report.map((r) => (
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
          ))}
      </section>

      {/* ---------------- version history (folded) */}
      <details id="versions" className={`${ui.card} group p-4 sm:p-6`}>
        <summary className="cursor-pointer text-lg font-semibold text-olive-800">Version history ({versions.length})</summary>
        <p className="mt-2 text-sm text-sand-500">Every change is kept. Restore makes an old version live again (as a new version).</p>
        <ul className="mt-3 divide-y divide-sand-100">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <span className="w-12 font-semibold text-olive-700">v{v.number}</span>
              <span className="min-w-0 flex-1 basis-56">
                {v.note}
                {v.ask_read && <span className="ml-2 rounded bg-gold-50 px-1.5 py-0.5 text-[11px] font-semibold text-gold-800">staff asked to read</span>}
                <span className="block text-xs text-sand-500">
                  {fmtDate(v.published_at)} by {(v.published_by && names.get(v.published_by)) || "-"}
                </span>
              </span>
              <span className="flex gap-2">
                <a href={`/sop/pdf?v=${v.number}`} className={`${ui.btnGhost} ${ui.btnSm}`}>
                  PDF
                </a>
                {v.id !== live?.id && <RestoreButton number={v.number} />}
                {v.id === live?.id && <span className="self-center text-xs font-semibold text-olive-700">live</span>}
              </span>
            </li>
          ))}
        </ul>
      </details>

      {/* ---------------- audit log (folded) */}
      <details id="audit" className={`${ui.card} p-4 sm:p-6`}>
        <summary className="cursor-pointer text-lg font-semibold text-olive-800">Audit log ({audit.length})</summary>
        <div className="-mx-4 mt-3 overflow-x-auto sm:mx-0">
          <table className="w-full text-sm">
            <tbody>
              {audit.map((r) => (
                <tr key={r.id} className="border-b border-sand-100 align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-sand-500">{fmtDate(r.at)}</td>
                  <td className="px-4 py-2">{(r.actor && names.get(r.actor)) || "-"}</td>
                  <td className="px-4 py-2 font-medium text-sand-700">{ACTION[r.action] ?? r.action}</td>
                  <td className="px-4 py-2">{what(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
