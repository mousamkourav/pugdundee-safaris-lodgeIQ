"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { grantRpAccess, revokeRpAccess } from "@/app/(dashboard)/red-panda/actions";

type Opt = { id: string; label: string };

export function RpAccessEditor({ rows, people, roles }: { rows: Opt[]; people: Opt[]; roles: Opt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [person, setPerson] = useState("");
  const [role, setRole] = useState("");
  const act = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else router.refresh();
    });
  return (
    <div className="space-y-6">
      {error && <p className={ui.alertError}>{error}</p>}
      <section className={`${ui.card} p-5`}>
        <h2 className="text-lg">Has access</h2>
        <ul className="mt-3 divide-y divide-sand-100 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <span>{r.label}</span>
              <button type="button" className={`${ui.btnDangerOutline} ${ui.btnSm}`} disabled={pending} onClick={() => act(() => revokeRpAccess(r.id))}>Remove</button>
            </li>
          ))}
          {!rows.length && <li className="py-2 text-sand-500">Only the super admin so far.</li>}
        </ul>
      </section>
      <section className={`${ui.card} grid gap-4 p-5 sm:grid-cols-2`}>
        <div className="space-y-2">
          <span className={ui.label}>Give access to a person</span>
          <select className={`${ui.select} w-full`} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Choose</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={pending || !person} onClick={() => act(() => grantRpAccess("user", person))}>Give access</button>
        </div>
        <div className="space-y-2">
          <span className={ui.label}>Give access to a role</span>
          <select className={`${ui.select} w-full`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Choose</option>
            {roles.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={pending || !role} onClick={() => act(() => grantRpAccess("role", role))}>Give access</button>
        </div>
      </section>
    </div>
  );
}
