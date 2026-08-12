import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isAdmin } from "@/lib/auth";
import { updateLodge } from "../actions";
import { PageHeader } from "@/components/page-header";
import { Field } from "@/components/field";

export default async function EditLodgePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { profile } = await requireUser();
  const { id } = await params;
  const { error } = await searchParams;

  const supabase = await createClient();
  const { data: lodge } = await supabase
    .from("lodges")
    .select("*")
    .eq("id", id)
    .single();

  if (!lodge) notFound();

  const admin = isAdmin(profile?.role);
  const update = updateLodge.bind(null, id);

  return (
    <div className="max-w-lg">
      <PageHeader title={lodge.name} description="Lodge details." />
      {error && (
        <p className="mb-4 rounded-lg bg-error-bg px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
      <form
        action={update}
        className="space-y-4 rounded-xl border border-sand-200 bg-white p-6"
      >
        <Field
          name="name"
          label="Lodge name"
          defaultValue={lodge.name}
          required
          disabled={!admin}
        />
        <Field
          name="location"
          label="Location"
          defaultValue={lodge.location ?? ""}
          disabled={!admin}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field
            name="room_count"
            label="Room count"
            type="number"
            defaultValue={lodge.room_count ?? ""}
            disabled={!admin}
          />
          <Field
            name="capacity"
            label="Capacity (pax)"
            type="number"
            defaultValue={lodge.capacity ?? ""}
            disabled={!admin}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-sand-700">Status</label>
          <select
            name="status"
            defaultValue={lodge.status}
            disabled={!admin}
            className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500 disabled:bg-sand-100 disabled:text-sand-500"
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
        {admin && (
          <div className="flex gap-2 pt-2">
            <button className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-olive-700">
              Save changes
            </button>
            <Link
              href="/lodges"
              className="rounded-lg border border-sand-200 px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-50"
            >
              Cancel
            </Link>
          </div>
        )}
      </form>
    </div>
  );
}
