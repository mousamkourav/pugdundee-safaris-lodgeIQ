// Server-side reads of sales_media with public URLs resolved.
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET, type MediaItem, type MediaOwner } from "@/lib/sales/master/types";

export async function getMedia(owner: MediaOwner, ownerId: string | null): Promise<MediaItem[]> {
  const supabase = await createClient();
  let q = supabase
    .from("sales_media")
    .select("id, storage_path, caption, is_cover, sort")
    .eq("owner_type", owner);
  q = ownerId ? q.eq("owner_id", ownerId) : q.is("owner_id", null);
  const { data } = await q.order("sort", { ascending: true }).order("created_at", { ascending: true });

  const bucket = supabase.storage.from(MEDIA_BUCKET);
  return ((data ?? []) as Omit<MediaItem, "url">[]).map((m) => ({
    ...m,
    url: bucket.getPublicUrl(m.storage_path).data.publicUrl,
  }));
}
