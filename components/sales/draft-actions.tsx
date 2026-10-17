"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { deleteDraft } from "@/app/(dashboard)/sales/queries/[id]/actions";

export function DraftActions({ queryId }: { queryId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!window.confirm("Delete this draft? This cannot be undone.")) return;
    setError(null);
    start(async () => {
      try {
        const res = await deleteDraft(queryId);
        if (res.error) setError(res.error);
        else {
          router.push("/sales/queries?status=draft");
          router.refresh();
        }
      } catch {
        setError("Could not reach the server. Check your connection and try again.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/sales/new?from=${queryId}`} className={ui.btnPrimary}>
        <Icon name="clipboard" className="h-[18px] w-[18px]" />
        Continue editing
      </Link>
      <button type="button" className={ui.btnDangerOutline} onClick={remove} disabled={pending}>
        <Icon name="trash" className="h-[18px] w-[18px]" />
        {pending ? "Deleting..." : "Delete draft"}
      </button>
      {error && <p className={`${ui.alertError} w-full`}>{error}</p>}
    </div>
  );
}
