"use client";

import { useState, useTransition } from "react";
import { ui } from "@/components/ui";
import { acknowledgeSop } from "../actions";

// "I have read it": the update the super admin asked staff to read (version N)
export function AckButton({ versionId, version }: { versionId: string; version: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        title={`Version ${version}`}
        className={ui.btnPrimary}
        onClick={() =>
          start(async () => {
            const r = await acknowledgeSop(versionId);
            setError("error" in r ? r.error : null);
          })
        }
      >
        {pending ? "Saving..." : "I have read it"}
      </button>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}
