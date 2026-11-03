"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { publishSop, restoreVersion } from "../admin-actions";

export function PublishForm({ next, disabled }: { next: number; disabled: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!confirm(`Publish the draft as version ${next}? Every member of staff with access will be asked to read it.`)) return;
        start(async () => {
          const r = await publishSop(note);
          if ("error" in r) setMsg({ ok: false, text: r.error });
          else {
            setMsg({ ok: true, text: `Version ${r.version} published.` });
            setNote("");
            router.refresh();
          }
        });
      }}
    >
      <label className="block">
        <span className={ui.label}>What changed (staff see this)</span>
        <textarea className={ui.input} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. New check-in steps; pool timings updated" required />
      </label>
      <button className={ui.btnPrimary} disabled={pending || disabled || !note.trim()}>
        {pending ? "Publishing..." : `Publish version ${next}`}
      </button>
      {msg && <p className={msg.ok ? ui.alertSuccess : ui.alertError}>{msg.text}</p>}
    </form>
  );
}

export function RestoreButton({ number }: { number: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className={ui.btnSecondary}
        disabled={pending}
        onClick={() => {
          if (!confirm(`Make version ${number} the draft again? The current draft is replaced (published versions are not changed). Staff see nothing until you publish.`)) return;
          start(async () => {
            const r = await restoreVersion(number);
            if ("error" in r) setErr(r.error);
            else router.push("/sop/edit");
          });
        }}
      >
        {pending ? "Restoring..." : `Restore version ${number} as the draft`}
      </button>
      {err && <p className={`${ui.alertError} mt-2`}>{err}</p>}
    </div>
  );
}
