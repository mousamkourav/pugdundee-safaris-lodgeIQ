"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, type ActionResult, type MediaOwner } from "@/lib/sales/master/types";

const OWNERS: MediaOwner[] = ["property", "room_category", "park", "addon", "brand"];

async function guard(): Promise<string | null> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSuperAdmin(cu.profile?.role)) return "Only super admins can manage photos.";
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
export async function addMedia(owner: MediaOwner, ownerId: string | null, paths: string[]): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { error: denied };
  if (!OWNERS.includes(owner)) return { error: "Unknown photo owner." };
  const prefix = `${owner}/${ownerId ?? "brand"}/`;
  if (!paths.length || paths.some((p) => !p.startsWith(prefix) || p.includes(".."))) return { error: "Invalid upload path." };

  const existing = await siblings(owner, ownerId);
  const hasCover = existing.some((m) => m.is_cover);
  let sort = existing.reduce((mx, m) => Math.max(mx, m.sort), -1);

  const rows = paths.map((storage_path, i) => ({
    owner_type: owner,
    owner_id: ownerId,
    storage_path,
    is_cover: !hasCover && i === 0,
    sort: ++sort,
  }));
  const supabase = await createClient();
  const { error } = await supabase.from("sales_media").insert(rows);
  if (error) return { error: error.message };
  return done();
}

export async function setCover(id: string): Promise<ActionResult> {
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

export async function moveMedia(id: string, direction: -1 | 1): Promise<ActionResult> {
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

export async function updateCaption(id: string, caption: string): Promise<ActionResult> {
  const denied = await guard();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const value = caption.trim().slice(0, 200) || null;
  const { error } = await supabase.from("sales_media").update({ caption: value }).eq("id", id);
  if (error) return { error: error.message };
  return done();
}

export async function deleteMedia(id: string): Promise<ActionResult> {
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
