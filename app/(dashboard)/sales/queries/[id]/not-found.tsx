import Link from "next/link";
import { ui } from "@/components/ui";

export default function QueryNotFound() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <div className={`${ui.card} space-y-3 p-6 text-center`}>
        <h1 className="text-xl">Query not found</h1>
        <p className="text-sm text-sand-600">It may have been deleted, or it is assigned to another member.</p>
        <Link href="/sales/queries" className={ui.btnPrimary}>All queries</Link>
      </div>
    </div>
  );
}
