"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEntity } from "@/lib/sales/master/entities";
import { parseRow } from "@/lib/sales/master/parse";
import { SETTINGS_FIELDS, setPath } from "@/lib/sales/master/settings";
import type { ActionResult } from "@/lib/sales/master/types";

async function requireSuper(): Promise<string | null> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSuperAdmin(cu.profile?.role)) return "Only super admins can change master data.";
  return null;
}

// Friendlier text for the most common database errors.
function explain(message: string): string {
  if (/duplicate key/i.test(message)) return "This already exists (a record with the same name or key is already saved).";
  if (/violates foreign key/i.test(message)) return "This record is still used elsewhere, so it cannot be deleted. Mark it inactive instead.";
  if (/violates check constraint/i.test(message)) return "Some values are not allowed together. Check dates (To must not be before From), and that weekly closures have a day of week and dated closures have both dates.";
  return message;
}

export async function saveRecord(entityKey: string, id: string | null, fd: FormData): Promise<ActionResult> {
  const denied = await requireSuper();
  if (denied) return { error: denied };
  const entity = getEntity(entityKey);
  if (!entity) return { error: "Unknown master data type." };

  const { row, error: parseError } = parseRow(entity.fields, fd);
  if (parseError) return { error: parseError };

  const supabase = await createClient();
  let savedId = id;

  if (id) {
    const { error } = await supabase.from(entity.table).update(row).eq("id", id);
    if (error) return { error: explain(error.message) };
  } else {
    const { data, error } = await supabase.from(entity.table).insert(row).select("id").single();
    if (error) return { error: explain(error.message) };
    savedId = (data as { id: string }).id;
  }

  // Every lodge/hotel needs a matching transfer location so routes can use it.
  if (entity.afterSave === "property-location" && savedId) {
    const name = String(row.name ?? "");
    const { data: loc } = await supabase.from("sales_locations").select("id").eq("property_id", savedId).maybeSingle();
    const res = loc
      ? await supabase.from("sales_locations").update({ name }).eq("id", (loc as { id: string }).id)
      : await supabase.from("sales_locations").insert({ type: "property", name, property_id: savedId });
    if (res.error) return { error: "Saved, but the transfer location could not be updated: " + res.error.message };
  }

  revalidatePath(`/sales/admin/${entity.key}`);
  revalidatePath("/sales/admin");
  return { ok: true, id: savedId ?? undefined };
}

export async function deleteRecord(entityKey: string, id: string): Promise<ActionResult> {
  const denied = await requireSuper();
  if (denied) return { error: denied };
  const entity = getEntity(entityKey);
  if (!entity) return { error: "Unknown master data type." };

  const supabase = await createClient();
  const { error } = await supabase.from(entity.table).delete().eq("id", id);
  if (error) return { error: explain(error.message) };

  revalidatePath(`/sales/admin/${entity.key}`);
  revalidatePath("/sales/admin");
  return { ok: true };
}

export async function saveSettings(fd: FormData): Promise<ActionResult> {
  const denied = await requireSuper();
  if (denied) return { error: denied };

  const { row, error: parseError } = parseRow(SETTINGS_FIELDS, fd);
  if (parseError) return { error: parseError };

  const slabs = row.payment_slabs;
  if (Array.isArray(slabs) && slabs.length) {
    const total = slabs.reduce((t: number, s: { pct?: unknown }) => t + Number(s?.pct ?? 0), 0);
    if (Math.abs(total - 100) > 0.001) return { error: `Payment schedule percentages add up to ${total}, not 100.` };
  }

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("sales_settings").select("data").eq("id", 1).single();
  if (readError) return { error: readError.message };

  // Merge into the existing jsonb so keys not on this form are kept.
  const data = { ...((current as { data: Record<string, unknown> }).data ?? {}) };
  for (const f of SETTINGS_FIELDS) setPath(data, f.path, row[f.name]);

  const { error } = await supabase.from("sales_settings").update({ data }).eq("id", 1);
  if (error) return { error: error.message };

  revalidatePath("/sales/admin/settings");
  return { ok: true };
}
