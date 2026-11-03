"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { grantAccess, revokeAccess } from "../admin-actions";

export function GrantForm({ people, roles }: { people: { id: string; label: string }[]; roles: { value: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const give = (input: { userId?: string; role?: string }, reset: () => void) =>
    start(async () => {
      const r = await grantAccess(input);
      if ("error" in r) setErr(r.error);
      else {
        setErr(null);
        reset();
        router.refresh();
      }
    });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (userId) give({ userId }, () => setUserId(""));
        }}
      >
        <label className="min-w-0 flex-1">
          <span className={ui.label}>A person</span>
          <select className={`${ui.select} w-full`} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose...</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button className={ui.btnPrimary} disabled={pending || !userId}>
          Give access
        </button>
      </form>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (role) give({ role }, () => setRole(""));
        }}
      >
        <label className="min-w-0 flex-1">
          <span className={ui.label}>Everyone with a role</span>
          <select className={`${ui.select} w-full`} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Choose...</option>
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button className={ui.btnPrimary} disabled={pending || !role}>
          Give access
        </button>
      </form>
      {err && <p className={`${ui.alertError} md:col-span-2`}>{err}</p>}
    </div>
  );
}

export function RemoveButton({ id, what }: { id: string; what: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`${ui.btnDangerOutline} ${ui.btnSm}`}
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove SOP access for ${what}?`)) return;
        start(async () => {
          const r = await revokeAccess(id);
          if ("error" in r) alert(r.error);
          router.refresh();
        });
      }}
    >
      Remove
    </button>
  );
}
