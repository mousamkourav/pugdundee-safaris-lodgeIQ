"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ui, Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { fmtDate } from "@/lib/sales/format";
import { PhoneField } from "@/components/sales/builder/guest-fields";
import { createSalesMember, updateSalesMember } from "@/app/(dashboard)/sales/members/actions";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  emergencyId?: string | null; // emergency contact on this member's guest itineraries
  role: string;
  status: "active" | "disabled";
  lastSignIn: string | null;
  counts: { total: number; open: number; booked: number; draft: number };
}

const ROLE_INFO: Record<string, { label: string; help: string }> = {
  sales_member: { label: "Sales member", help: "Creates itineraries and manages their own queries." },
  sales_admin: { label: "Sales admin", help: "Everything in Sales: all queries, master data, rates, photos, settings and members. No Lodge Reporting." },
  super_admin: { label: "Super admin", help: "" },
  senior_manager: { label: "Senior manager", help: "" },
};
const OFFLINE = "Could not reach the server. Check your connection and try again.";

// A strong password suggestion: letters, digits and a symbol, easy to read aloud.
function suggestPassword() {
  const words = ["Tiger", "Sal", "Kanha", "Jeep", "Forest", "Pench", "Banyan", "Monsoon", "Safari", "Leopard"];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

type Form = { id: string | null; full_name: string; email: string; phone: string; role: string; status: "active" | "disabled"; password: string; emergencyId: string };
const EMPTY: Form = { id: null, full_name: "", email: "", phone: "", role: "sales_member", status: "active", password: "", emergencyId: "" };

export function MembersManager({ team, leaders, me }: { team: MemberRow[]; leaders: MemberRow[]; me: string }) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("active");

  const shown = team.filter((m) => filter === "all" || m.status === filter);
  const editingSelf = form?.id === me;

  function openAdd() {
    setError(null);
    setShowPw(true);
    setForm({ ...EMPTY, password: suggestPassword() });
  }
  function openEdit(m: MemberRow) {
    setError(null);
    setShowPw(false);
    setForm({ id: m.id, full_name: m.name, email: m.email, phone: m.phone, role: m.role, status: m.status, password: "", emergencyId: m.emergencyId ?? "" });
  }

  function submit() {
    if (!form) return;
    setError(null);
    start(async () => {
      try {
        const res = form.id
          ? await updateSalesMember(form.id, {
              full_name: form.full_name,
              phone: form.phone,
              role: editingSelf ? undefined : form.role,
              status: editingSelf ? undefined : form.status,
              password: form.password || undefined,
              emergency_id: form.emergencyId || null,
            })
          : await createSalesMember({ full_name: form.full_name, email: form.email, phone: form.phone, role: form.role, password: form.password });
        if (res.error) {
          setError(res.error);
          return;
        }
        setNotice(
          form.id
            ? `${form.full_name} updated.${form.password ? " Share the new password with them privately." : ""}`
            : `${form.full_name} can now sign in with ${form.email}. Share the password with them privately and ask them to change it under My account.`
        );
        setForm(null);
        router.refresh();
      } catch {
        setError(OFFLINE);
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Sales admin</p>
          <h1 className="mt-1 text-2xl">Sales members</h1>
          <p className="mt-1 text-sm text-sand-500">
            The Sales team only. Lodge staff are managed separately in Lodge Reporting, Users &amp; access.
          </p>
        </div>
        <button type="button" className={ui.btnPrimary} onClick={openAdd}>
          <Icon name="plus" className="h-[18px] w-[18px]" />
          Add member
        </button>
      </div>

      {notice && <p className={ui.alertSuccess}>{notice}</p>}

      <div className="flex gap-1 rounded-lg border border-sand-200 bg-sand-100 p-1 text-sm sm:w-fit">
        {(["active", "disabled", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 font-medium ${filter === f ? "bg-white text-olive-800 shadow-card" : "text-sand-500 hover:text-olive-800"}`}
          >
            {f === "active" ? `Active (${team.filter((m) => m.status === "active").length})` : f === "disabled" ? `Deactivated (${team.filter((m) => m.status === "disabled").length})` : "All"}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className={ui.empty}>{filter === "active" ? "No Sales members yet. Add the first one." : "Nobody here."}</div>
      ) : (
        <div className={`${ui.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                  <th className="px-4 py-2.5">Member</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Mobile</th>
                  <th className="px-4 py-2.5 text-right">Queries</th>
                  <th className="px-4 py-2.5">Last sign-in</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.id} className={`border-t border-sand-200 ${m.status === "disabled" ? "opacity-60" : ""}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-olive-800">
                        {m.name}
                        {m.id === me && <span className="ml-1.5 text-xs font-normal text-sand-500">(you)</span>}
                      </p>
                      <p className="text-xs text-sand-500">{m.email}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge tone={m.role === "sales_admin" ? "olive" : "neutral"}>{ROLE_INFO[m.role]?.label ?? m.role}</Badge>
                      {m.status === "disabled" && <Badge tone="error" className="ml-1.5">Deactivated</Badge>}
                    </td>
                    <td className="tabular whitespace-nowrap px-4 py-2.5">{m.phone || "-"}</td>
                    <td className="tabular whitespace-nowrap px-4 py-2.5 text-right">
                      <Link href={`/sales/queries?member=${m.id}`} className="text-olive-600 hover:underline" title="Open, booked and all quotes; drafts not counted">
                        {m.counts.open} open &middot; {m.counts.booked} booked &middot; {m.counts.total} total
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-sand-500">{m.lastSignIn ? fmtDate(m.lastSignIn) : "Never"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => openEdit(m)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {leaders.length > 0 && (
        <p className="text-xs text-sand-500">
          Also with full Sales access: {leaders.map((l) => `${l.name} (${ROLE_INFO[l.role]?.label ?? l.role})`).join(", ")}. They are managed in Users &amp; access.
        </p>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-olive-800/35 p-4 backdrop-blur-sm sm:items-center" onClick={() => !pending && setForm(null)}>
          <div role="dialog" aria-modal="true" aria-label={form.id ? "Edit member" : "Add member"} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-overlay" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 border-b border-sand-200 px-5 py-4">
              <h2 className="text-lg">{form.id ? `Edit ${form.full_name || "member"}` : "Add a Sales member"}</h2>
              <button type="button" className="rounded-lg p-1.5 text-sand-500 hover:bg-sand-100" onClick={() => setForm(null)} aria-label="Close">
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              {error && <p className={ui.alertError}>{error}</p>}
              <label className="block">
                <span className={ui.label}>Full name <span className="text-error">*</span></span>
                <input className={ui.inputSm} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </label>
              <label className="block">
                <span className={ui.label}>Email (sign-in) {!form.id && <span className="text-error">*</span>}</span>
                <input className={ui.inputSm} type="email" value={form.email} disabled={!!form.id} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                {form.id && <span className="mt-1 block text-xs text-sand-500">The sign-in email cannot be changed here.</span>}
              </label>
              <div>
                <span className={ui.label}>Mobile</span>
                <PhoneField value={form.phone} country="IN" onChange={(phone) => setForm({ ...form, phone })} />
              </div>
              {form.id && (
                <label className="block">
                  <span className={ui.label}>Emergency contact on their itineraries</span>
                  <select className={`${ui.select} w-full !py-2`} value={form.emergencyId} onChange={(e) => setForm({ ...form, emergencyId: e.target.value })}>
                    <option value="">Automatic: another active Sales member</option>
                    {team
                      .filter((t) => t.id !== form.id && t.status === "active")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.phone ? ` (${t.phone})` : ""}
                        </option>
                      ))}
                  </select>
                  <span className="mt-1 block text-xs text-sand-500">
                    The guest PDF shows this member as the safari consultant (name, mobile, email) and the person chosen here as the emergency contact. Members keep their own mobile up to date under My account.
                  </span>
                </label>
              )}
              <fieldset disabled={editingSelf}>
                <span className={ui.label}>Role <span className="text-error">*</span></span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["sales_member", "sales_admin"] as const).map((r) => (
                    <label key={r} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${form.role === r ? "border-olive-600 bg-olive-50" : "border-sand-200"}`}>
                      <input type="radio" name="role" className="mt-0.5 h-4 w-4" checked={form.role === r} onChange={() => setForm({ ...form, role: r })} />
                      <span>
                        <span className="block font-semibold text-olive-800">{ROLE_INFO[r].label}</span>
                        <span className="block text-xs text-sand-600">{ROLE_INFO[r].help}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {editingSelf && <p className="mt-1 text-xs text-sand-500">You cannot change your own role or deactivate yourself.</p>}
              </fieldset>
              {form.id && !editingSelf && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={form.status === "active"} onChange={(e) => setForm({ ...form, status: e.target.checked ? "active" : "disabled" })} />
                  Active (untick to deactivate: they can no longer sign in; their queries are kept)
                </label>
              )}
              <label className="block">
                <span className={ui.label}>{form.id ? "New password (leave empty to keep the current one)" : "Password"} {!form.id && <span className="text-error">*</span>}</span>
                <div className="flex gap-2">
                  <input
                    className={`${ui.inputSm} font-mono`}
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                  <button type="button" className={`${ui.btnSecondary} ${ui.btnSm} shrink-0`} onClick={() => setShowPw((v) => !v)}>
                    {showPw ? "Hide" : "Show"}
                  </button>
                  <button type="button" className={`${ui.btnSecondary} ${ui.btnSm} shrink-0`} onClick={() => { setForm({ ...form, password: suggestPassword() }); setShowPw(true); }}>
                    Suggest
                  </button>
                </div>
                <span className="mt-1 block text-xs text-sand-500">At least 8 characters with a letter and a number.</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-sand-200 bg-sand-50 px-5 py-3">
              <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setForm(null)} disabled={pending}>Cancel</button>
              <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} onClick={submit} disabled={pending}>
                {pending ? "Saving..." : form.id ? "Save changes" : "Create member"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
