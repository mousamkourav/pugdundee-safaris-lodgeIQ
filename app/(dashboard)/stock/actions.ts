"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

function num(v: FormDataEntryValue | null): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function back(lodge: string, month: string) {
  revalidatePath("/stock");
  redirect(`/stock?lodge=${lodge}&month=${month}`);
}

export async function addStockItem(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("stock_items").insert({
    lodge_id,
    name: String(fd.get("name")),
    category: String(fd.get("category") ?? "") || null,
    unit: String(fd.get("unit") ?? "") || null,
    current_qty: num(fd.get("current_qty")),
    reorder_level: num(fd.get("reorder_level")),
  });
  back(lodge_id, month);
}

export async function deleteStockItem(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s.from("stock_items").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function addPurchase(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const item_id = String(fd.get("item_id") || "");
  const qty = num(fd.get("qty"));

  // Optional bill upload -> Supabase Storage (service-role client, server only).
  let bill_attachment_id: string | null = null;
  const file = fd.get("bill") as File | null;
  if (file && typeof file === "object" && file.size > 0) {
    const admin = createAdminClient();
    const safe = file.name.replace(/[^\w.\-]/g, "_");
    const path = `${lodge_id}/purchases/${Date.now()}_${safe}`;
    const buf = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from("attachments")
      .upload(path, buf, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (!upErr) {
      const { data: att } = await admin
        .from("attachments")
        .insert({
          lodge_id,
          module: "purchases",
          file_path: path,
          file_name: file.name,
          uploaded_by: cu.user.id,
        })
        .select("id")
        .single();
      bill_attachment_id = (att?.id as string) ?? null;
    }
  }

  const s = await createClient();
  await s.from("purchases").insert({
    lodge_id,
    item_id: item_id || null,
    item_name: String(fd.get("item_name") ?? "") || null,
    qty,
    rate: num(fd.get("rate")),
    vendor: String(fd.get("vendor") ?? "") || null,
    purchase_date: String(fd.get("purchase_date")),
    bill_attachment_id,
    created_by: cu.user.id,
  });

  // if linked to a tracked item, add qty to stock
  if (item_id) {
    const { data: item } = await s
      .from("stock_items")
      .select("current_qty")
      .eq("id", item_id)
      .single();
    if (item) {
      await s
        .from("stock_items")
        .update({ current_qty: Number(item.current_qty || 0) + qty })
        .eq("id", item_id);
    }
  }
  back(lodge_id, month);
}

export async function deletePurchase(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s.from("purchases").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}
