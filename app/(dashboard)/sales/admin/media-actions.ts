"use server";

import { safe } from "@/lib/sales/safe";
import { revalidatePath } from "next/cache";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, type ActionResult, type MediaOwner } from "@/lib/sales/master/types";
import { MEDIA_LIMIT, PHOTO_CATEGORIES, type PhotoCategory } from "@/lib/sales/media-import";

const OWNERS: MediaOwner[] = ["property", "room_category", "park", "addon", "brand"];

async function guard(): Promise<string | null> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesAdmin(cu.profile?.role)) return "Only Sales admins can manage photos.";
  return null;
}

type Row = { id: string; owner_type: MediaOwner; owner_id: string | null; storage_path: string; is_cover: boolean; sort: number };

async function siblings(owner: MediaOwner, ownerId: string | null) {
  const supabase = await createClient();
  let q = supabase.from("sales_media").select("id, owner_type, owner_id, storage_path, is_cover, sort").eq("owner_type", owner);
  q = ownerId ? q.eq("owner_id", ownerId) : q.is("owner_id", null);
  const { data } = await q.order("sort", { ascending: true }).order("created_at", { ascending: true });
  return (data ?? []) as Row[];
}

async function getRow(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sales_media")
    .select("id, owner_type, owner_id, storage_path, is_cover, sort")
    .eq("id", id)
    .maybeSingle();
  return data as Row | null;
}

function done(): ActionResult {
  revalidatePath("/sales/admin", "layout");
  return { ok: true };
}

// Files are uploaded straight from the browser to Storage (server actions have
// a 1 MB body limit); this records the uploaded paths.
async function addMediaUnsafe(owner: MediaOwner, ownerId: string | null, paths: string[]): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { error: denied };
  if (!OWNERS.includes(owner)) return { error: "Unknown photo owner." };
  const prefix = `${owner}/${ownerId ?? "brand"}/`;
  if (!paths.length || paths.some((p) => !p.startsWith(prefix) || p.includes(".."))) return { error: "Invalid upload path." };

  const existing = await siblings(owner, ownerId);
  const hasCover = existing.some((m) => m.is_cover);
  let sort = existing.reduce((mx, m) => Math.max(mx, m.sort), -1);

  const defaultCategory = owner === "property" ? "exterior" : owner === "room_category" ? "room" : null;
  const rows = paths.map((storage_path, i) => ({
    owner_type: owner,
    owner_id: ownerId,
    storage_path,
    category: defaultCategory,
    is_cover: !hasCover && i === 0,
    sort: ++sort,
  }));
  const supabase = await createClient();
  const { error } = await supabase.from("sales_media").insert(rows);
  if (error) return { error: error.message };
  return done();
}

async function setCoverUnsafe(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { error: denied };
  const row = await getRow(id);
  if (!row) return { error: "Photo not found." };

  const supabase = await createClient();
  let clear = supabase.from("sales_media").update({ is_cover: false }).eq("owner_type", row.owner_type);
  clear = row.owner_id ? clear.eq("owner_id", row.owner_id) : clear.is("owner_id", null);
  const r1 = await clear;
  if (r1.error) return { error: r1.error.message };
  const r2 = await supabase.from("sales_media").update({ is_cover: true }).eq("id", id);
  if (r2.error) return { error: r2.error.message };
  return done();
}

async function moveMediaUnsafe(id: string, direction: -1 | 1): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { error: denied };
  const row = await getRow(id);
  if (!row) return { error: "Photo not found." };

  const list = await siblings(row.owner_type, row.owner_id);
  const i = list.findIndex((m) => m.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];

  // Renumber 0..n-1 so the order is always clean.
  const supabase = await createClient();
  for (let k = 0; k < list.length; k++) {
    if (list[k].sort !== k) {
      const { error } = await supabase.from("sales_media").update({ sort: k }).eq("id", list[k].id);
      if (error) return { error: error.message };
    }
  }
  return done();
}

async function updateCaptionUnsafe(id: string, caption: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const value = caption.trim().slice(0, 200) || null;
  const { error } = await supabase.from("sales_media").update({ caption: value }).eq("id", id);
  if (error) return { error: error.message };
  return done();
}

async function deleteMediaUnsafe(id: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { error: denied };
  const row = await getRow(id);
  if (!row) return { error: "Photo not found." };

  const supabase = await createClient();
  const { error } = await supabase.from("sales_media").delete().eq("id", id);
  if (error) return { error: error.message };
  // Remove the file too; a failure here only leaves an unused file behind.
  await supabase.storage.from(MEDIA_BUCKET).remove([row.storage_path]);

  if (row.is_cover) {
    const rest = await siblings(row.owner_type, row.owner_id);
    if (rest[0]) await supabase.from("sales_media").update({ is_cover: true }).eq("id", rest[0].id);
  }
  return done();
}

// ---------------- bulk import ----------------
export interface ImportedPhoto {
  owner: "property" | "room_category" | "brand";
  ownerId: string | null;
  path: string; // where the browser uploaded the compressed copy
  category: string;
  source_ref: string;
  bytes: number;
}

async function importMediaBatchUnsafe(items: ImportedPhoto[]): Promise<ActionResult & { inserted?: number; skipped?: number }> {
  const denied = await guard();
  if (denied) return { error: denied };
  if (!items.length) return { ok: true, inserted: 0, skipped: 0 };
  if (items.length > 50) return { error: "Too many photos in one batch." };

  const supabase = await createClient();
  let inserted = 0;
  let skipped = 0;
  // Group by destination so limits and duplicates are checked per gallery.
  const byOwner = new Map<string, ImportedPhoto[]>();
  for (const it of items) {
    if (!["property", "room_category", "brand"].includes(it.owner)) return { error: "Unknown photo destination." };
    if ((it.owner === "brand") !== (it.ownerId === null)) return { error: "Invalid photo destination." };
    if (!PHOTO_CATEGORIES.includes(it.category as PhotoCategory)) return { error: "Unknown photo category." };
    const prefix = `${it.owner}/${it.ownerId ?? "brand"}/`;
    if (!it.path.startsWith(prefix) || it.path.includes("..")) return { error: "Invalid upload path." };
    const key = `${it.owner}|${it.ownerId ?? ""}`;
    byOwner.set(key, [...(byOwner.get(key) ?? []), it]);
  }

  for (const group of byOwner.values()) {
    const { owner, ownerId } = group[0];
    const existing = await siblings(owner, ownerId);
    const { data: refs } = await (ownerId
      ? supabase.from("sales_media").select("source_ref").eq("owner_type", owner).eq("owner_id", ownerId)
      : supabase.from("sales_media").select("source_ref").eq("owner_type", owner).is("owner_id", null));
    const known = new Set(((refs ?? []) as { source_ref: string | null }[]).map((r) => r.source_ref).filter(Boolean));
    const fresh = group.filter((g) => !known.has(g.source_ref));
    skipped += group.length - fresh.length;
    const room = MEDIA_LIMIT[owner] - existing.length;
    if (fresh.length > room) {
      return { error: `Not enough room: this gallery holds ${MEDIA_LIMIT[owner]} photos and has ${existing.length}. Untick ${fresh.length - Math.max(0, room)} photo(s).` };
    }
    if (!fresh.length) continue;
    const hasCover = existing.some((m) => m.is_cover);
    let sort = existing.reduce((mx, m) => Math.max(mx, m.sort), -1);
    const rows = fresh.map((g, i) => ({
      owner_type: owner,
      owner_id: ownerId,
      storage_path: g.path,
      category: g.category,
      source_ref: g.source_ref.slice(0, 600),
      bytes: Math.max(0, Math.round(g.bytes)),
      is_cover: !hasCover && i === 0,
      sort: ++sort,
    }));
    const { error } = await supabase.from("sales_media").insert(rows);
    if (error) return { error: error.message };
    inserted += rows.length;
  }
  return { ...done(), inserted, skipped };
}

async function updateMediaCategoryUnsafe(id: string, category: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { error: denied };
  if (!PHOTO_CATEGORIES.includes(category as PhotoCategory)) return { error: "Unknown category." };
  const supabase = await createClient();
  const { error } = await supabase.from("sales_media").update({ category }).eq("id", id);
  if (error) return { error: error.message };
  return done();
}

// Public actions: same as above, but failures come back as { error } instead of crashing.
export async function addMedia(owner: MediaOwner, ownerId: string | null, paths: string[]): Promise<ActionResult> {
  return safe("addMedia", () => addMediaUnsafe(owner, ownerId, paths));
}

export async function setCover(id: string): Promise<ActionResult> {
  return safe("setCover", () => setCoverUnsafe(id));
}

export async function moveMedia(id: string, direction: -1 | 1): Promise<ActionResult> {
  return safe("moveMedia", () => moveMediaUnsafe(id, direction));
}

export async function updateCaption(id: string, caption: string): Promise<ActionResult> {
  return safe("updateCaption", () => updateCaptionUnsafe(id, caption));
}

export async function deleteMedia(id: string): Promise<ActionResult> {
  return safe("deleteMedia", () => deleteMediaUnsafe(id));
}
export async function importMediaBatch(items: ImportedPhoto[]): Promise<ActionResult & { inserted?: number; skipped?: number }> {
  return safe("importMediaBatch", () => importMediaBatchUnsafe(items));
}
export async function updateMediaCategory(id: string, category: string): Promise<ActionResult> {
  return safe("updateMediaCategory", () => updateMediaCategoryUnsafe(id, category));
}
