import { requireSopEditor, fmtDay } from "@/lib/sop/server";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type Role } from "@/lib/auth";
import { audience, isSopEditor, type AccessRow, type Person } from "@/lib/sop/access";
import { ui } from "@/components/ui";
import { GrantForm, RemoveButton } from "./access-form";

export const metadata = { title: "SOP access" };

// Who may read the SOP: by person or by role (either is enough). The super admin always can.
export default async function SopAccessPage() {
  const { documentId } = await requireSopEditor();
  const supabase = await createClient();
  const [{ data: rows }, { data: profiles }] = await Promise.all([
    supabase.from("sop_access").select("id, user_id, role, granted_at").eq("document_id", documentId).order("granted_at"),
    supabase.from("profiles").select("id, full_name, role, status").order("full_name"),
  ]);
  const access = (rows ?? []) as (AccessRow & { id: string; granted_at: string })[];
  const people = (profiles ?? []) as Person[];
  const nameOf = new Map(people.map((p) => [p.id, p.full_name || "(no name)"]));
  const label = (r: string) => ROLE_LABELS[r as Role] ?? r;
  const byRole = access.filter((a) => a.role);
  const byPerson = access.filter((a) => a.user_id);
  const choosablePeople = people
    .filter((p) => (p.status ?? "active") === "active" && !isSopEditor(p.role) && !byPerson.some((a) => a.user_id === p.id))
    .map((p) => ({ id: p.id, label: `${p.full_name || "(no name)"}${p.role ? ` - ${label(p.role)}` : ""}` }));
  const choosableRoles = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => !isSopEditor(r) && !byRole.some((a) => a.role === r)).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const total = audience(people, access).length;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl">SOP access</h1>
        <p className="mt-1 text-sm text-sand-500">
          Give access to a person, or to everyone with a role. Either is enough. Removing it takes effect on their next click. {total} people can read the SOP now (plus the super admin).
        </p>
      </div>

      <div className={`${ui.card} p-4 sm:p-6`}>
        <GrantForm people={choosablePeople} roles={choosableRoles} />
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className={`${ui.card} p-4 sm:p-6`}>
          <h2 className="text-lg">By role</h2>
          {!byRole.length ? (
            <p className="mt-2 text-sm text-sand-500">No roles yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-sand-100">
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
        </section>
        <section className={`${ui.card} p-4 sm:p-6`}>
          <h2 className="text-lg">By person</h2>
          {!byPerson.length ? (
            <p className="mt-2 text-sm text-sand-500">No one yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-sand-100">
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
        </section>
      </div>
    </div>
  );
}
