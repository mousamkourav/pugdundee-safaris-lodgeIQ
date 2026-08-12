import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser, isAdmin } from "@/lib/auth";
import { createLodge } from "../actions";
import { PageHeader } from "@/components/page-header";
import { Field } from "@/components/field";

export default async function NewLodgePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { profile } = await requireUser();
  if (!isAdmin(profile?.role)) redirect("/lodges");
  const { error } = await searchParams;

  return (
    <div className="max-w-lg">
      <PageHeader title="Add lodge" description="Create a new property." />
      {error && (
        <p className="mb-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
      <form
        action={createLodge}
        className="space-y-4 rounded-xl border border-sand-200 bg-white p-6"
      >
        <Field name="name" label="Lodge name" required />
        <Field name="location" label="Location" />
        <div className="grid grid-cols-2 gap-4">
          <Field name="room_count" label="Room count" type="number" />
          <Field name="capacity" label="Capacity (pax)" type="number" />
        </div>
        <div className="flex gap-2 pt-2">
          <button className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-olive-700">
            Save lodge
          </button>
          <Link
            href="/lodges"
            className="rounded-lg border border-sand-200 px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-50"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
