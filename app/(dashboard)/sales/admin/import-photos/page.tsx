import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PhotoImporter, type ImporterGallery } from "@/components/sales/photo-importer";

// Bulk photo import (Sales admins only: the admin layout checks that).
export default async function ImportPhotosPage() {
  const supabase = await createClient();
  const [{ data: props }, { data: rooms }, { data: media }] = await Promise.all([
    supabase.from("sales_properties").select("id, name").eq("active", true).order("name"),
    supabase.from("sales_room_categories").select("id, property_id, name").eq("active", true).order("name"),
    supabase.from("sales_media").select("owner_type, owner_id, source_ref, bytes"),
  ]);

  const lodges = (props ?? []) as { id: string; name: string }[];
  const roomRows = (rooms ?? []) as { id: string; property_id: string; name: string }[];
  const mediaRows = (media ?? []) as { owner_type: string; owner_id: string | null; source_ref: string | null; bytes: number | null }[];

  const count = (owner: string, id: string | null) => mediaRows.filter((m) => m.owner_type === owner && m.owner_id === id).length;
  const galleries: ImporterGallery[] = [
    { key: "brand|", owner: "brand", ownerId: null, label: "Brand photos", existing: count("brand", null) },
    ...lodges.map((l) => ({ key: `property|${l.id}`, owner: "property" as const, ownerId: l.id, label: l.name, existing: count("property", l.id) })),
    ...roomRows.map((r) => ({
      key: `room_category|${r.id}`,
      owner: "room_category" as const,
      ownerId: r.id,
      label: `${lodges.find((l) => l.id === r.property_id)?.name ?? "Lodge"} - ${r.name}`,
      existing: count("room_category", r.id),
    })),
  ];
  const knownRefs = mediaRows.map((m) => m.source_ref).filter((x): x is string => !!x);
  const salesMb = Math.round((mediaRows.reduce((t, m) => t + (m.bytes ?? 0), 0) / 1024 / 1024) * 10) / 10;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/sales/admin" className="text-xs font-medium text-sand-500 hover:text-olive-600">Master data</Link>
        <h1 className="mt-1 text-2xl">Import photos</h1>
        <p className="mt-1 max-w-3xl text-sm text-sand-500">
          Drag folders from your computer (with Google Drive for desktop, your shared drive is a folder in File Explorer). Photos are matched to lodges,
          rooms and brand themes by their folder names, resized to 1600 px and compressed in your browser, so the originals never leave your computer.
        </p>
      </div>
      <PhotoImporter
        lodges={lodges}
        rooms={roomRows}
        galleries={galleries}
        knownRefs={knownRefs}
        usage={{ photos: mediaRows.length, mb: salesMb }}
      />
    </div>
  );
}
