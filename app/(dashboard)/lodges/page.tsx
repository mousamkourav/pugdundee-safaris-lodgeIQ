import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, isAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";

export default async function LodgesPage() {
  const { profile } = await requireUser();
  const supabase = await createClient();
  const { data: lodges } = await supabase
    .from("lodges")
    .select("*")
    .order("name");

  const admin = isAdmin(profile?.role);

  const rows = (lodges ?? []).map((l) => ({
    name: (
      <Link href={`/lodges/${l.id}`} className="text-olive-700 hover:underline">
        {l.name}
      </Link>
    ),
    location: l.location ?? "—",
    room_count: l.room_count ?? "—",
    status: l.status,
  }));

  return (
    <div>
      <PageHeader
        title="Lodges"
        description="All properties in the group."
        action={
          admin ? (
            <Link
              href="/lodges/new"
              className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-olive-700"
            >
              Add lodge
            </Link>
          ) : null
        }
      />
      <DataTable
        columns={[
          { key: "name", label: "Name" },
          { key: "location", label: "Location" },
          { key: "room_count", label: "Rooms" },
          { key: "status", label: "Status" },
        ]}
        rows={rows}
        empty="No lodges yet. Add your first lodge to get started."
      />
    </div>
  );
}
