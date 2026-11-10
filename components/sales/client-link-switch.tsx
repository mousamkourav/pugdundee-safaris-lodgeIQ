"use client";

// The query page's "Turn the client link off / on" (all versions of the quote).
import { useState, useTransition } from "react";
import { ui } from "@/components/ui";
import { setClientLink } from "@/app/(dashboard)/sales/queries/[id]/link-actions";

export function ClientLinkSwitch({ queryId, off }: { queryId: string; off: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-3 space-y-1">
      {off && <p className="rounded-lg border border-error-border bg-error-bg px-3 py-2 text-xs text-error">The client link is turned off: the guest sees &quot;This link is no longer active&quot;.</p>}
      <button
        type="button"
        disabled={pending}
        className={`${ui.btnGhost} ${ui.btnSm}`}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await setClientLink(queryId, off);
            if (r.error) setError(r.error);
          })
        }
      >
        {pending ? "Saving..." : off ? "Turn the client link on again" : "Turn the client link off"}
      </button>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
