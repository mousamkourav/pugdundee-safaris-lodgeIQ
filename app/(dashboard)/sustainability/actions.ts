"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (v === null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
function back(lodge: string, month: string) {
  revalidatePath("/sustainability");
  redirect(`/sustainability?lodge=${lodge}&month=${month}`);
}

export async function addTds(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("tds_readings").insert({
    lodge_id,
    entry_date: String(fd.get("entry_date")),
    station_tds: numOrNull(fd.get("station_tds")),
    kitchen_tds: numOrNull(fd.get("kitchen_tds")),
    notes: String(fd.get("notes") ?? "") || null,
    created_by: cu.user.id,
  });
  back(lodge_id, month);
}

export async function deleteTds(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s.from("tds_readings").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function addBreakdown(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("equipment_breakdowns").insert({
    lodge_id,
    entry_date: String(fd.get("entry_date")),
    description: String(fd.get("description")),
    notes: String(fd.get("notes") ?? "") || null,
  });
  back(lodge_id, month);
}

export async function toggleBreakdown(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const resolvedNow = String(fd.get("resolved")) === "true";
  const s = await createClient();
  await s
    .from("equipment_breakdowns")
    .update({ resolved: !resolvedNow })
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function deleteBreakdown(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s.from("equipment_breakdowns").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function addPhoto(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const caption = String(fd.get("caption") || "Photo");
  const file = fd.get("photo") as File | null;
  if (file && typeof file === "object" && file.size > 0) {
    const admin = createAdminClient();
    const safe = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${lodge_id}/sustainability/${Date.now()}_${safe}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error } = await admin.storage
      .from("attachments")
      .upload(path, buf, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });
    if (!error) {
      await admin.from("attachments").insert({
        lodge_id,
        module: "sustainability",
        file_path: path,
        file_name: file.name,
        uploaded_by: cu.user.id,
        extra: { caption },
      });
    }
  }
  back(lodge_id, month);
}

export async function deletePhoto(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const admin = createAdminClient();
  const id = String(fd.get("id"));
  const { data: att } = await admin
    .from("attachments")
    .select("file_path")
    .eq("id", id)
    .maybeSingle();
  if (att?.file_path) {
    await admin.storage.from("attachments").remove([att.file_path]);
  }
  await admin.from("attachments").delete().eq("id", id);
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}
