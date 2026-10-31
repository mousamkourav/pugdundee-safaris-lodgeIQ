"use server";

import { revalidatePath } from "next/cache";
import { revalidateMasterData } from "@/lib/sales/master/cache";
import { safe } from "@/lib/sales/safe";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEntity } from "@/lib/sales/master/entities";
import { RATE_SHEETS, fromCell, isEditable, sameValue, toCell, type CancellationRow, type PaymentRow } from "@/lib/sales/master/rates-sheet";
import { checkCancellationRows, checkPaymentRows } from "@/lib/sales/master/slabs";
import { hasRoad } from "@/lib/sales/master/missing-transfers";
import type { NewTransfer } from "@/lib/sales/master/missing-transfers-workbook";

type Change = { entity: string; id: string; field: string; old: unknown; new: unknown };
export type ApplyResult = { ok?: boolean; error?: string; applied?: number; skipped?: string[] };

// Applies the changes shown on the import page. Every value is checked again
// here (the browser is not trusted), and a value someone changed in LodgeIQ
// since the preview is not overwritten.
async function applyUnsafe(input: {
  changes: Change[];
  payment?: PaymentRow[] | null;
  cancellation?: CancellationRow[] | null;
  newTransfers?: NewTransfer[] | null;
}): Promise<ApplyResult> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesAdmin(cu.profile?.role)) return { error: "Only Sales admins can import rates." };
  if (!Array.isArray(input.changes) || input.changes.length > 5000) return { error: "Nothing to apply." };
  const supabase = await createClient();
  const skipped: string[] = [];
  let applied = 0;

  // group by row: one update per row
  const byRow = new Map<string, { entity: string; id: string; changes: Change[] }>();
  for (const c of input.changes) {
    if (!RATE_SHEETS.some((s) => s.entity === c.entity) || typeof c.id !== "string" || !/^[0-9a-f-]{36}$/i.test(c.id)) continue;
    const k = `${c.entity}|${c.id}`;
    const g = byRow.get(k) ?? { entity: c.entity, id: c.id, changes: [] };
    g.changes.push(c);
    byRow.set(k, g);
  }

  for (const g of byRow.values()) {
    const entity = getEntity(g.entity)!;
    const { data: cur } = await supabase.from(entity.table).select("*").eq("id", g.id).maybeSingle();
    if (!cur) {
      skipped.push(`${entity.title}: a row no longer exists.`);
      continue;
    }
    const patch: Record<string, unknown> = {};
    for (const c of g.changes) {
      const f = entity.fields.find((x) => x.name === c.field);
      if (!f || !isEditable(f)) continue;
      // the same checks as the Master data form
      const checked = fromCell(f, toCell(f, c.new) as never);
      if (checked.error) {
        skipped.push(`${entity.title}: ${checked.error}`);
        continue;
      }
      if (!sameValue(f, (cur as Record<string, unknown>)[c.field], c.old)) {
        skipped.push(`${entity.title}: ${f.label} was changed in LodgeIQ after the preview, so it was kept.`);
        continue;
      }
      patch[c.field] = checked.value;
    }
    if (!Object.keys(patch).length) continue;
    const { error } = await supabase.from(entity.table).update(patch).eq("id", g.id);
    if (error) skipped.push(`${entity.title}: ${/check constraint/i.test(error.message) ? "some values are not allowed together (check that To is not before From)" : error.message}`);
    else applied += Object.keys(patch).length;
  }

  if (input.payment || input.cancellation) {
    const { data: s, error } = await supabase.from("sales_settings").select("data").eq("id", 1).single();
    if (error) skipped.push("Payment & cancellation: " + error.message);
    else {
      const data = { ...((s as { data: Record<string, unknown> }).data ?? {}) };
      if (input.payment) {
        const checked = checkPaymentRows(input.payment);
        if (checked.error) skipped.push(checked.error);
        else {
          data.payment_slabs = checked.rows;
          applied++;
        }
      }
      if (input.cancellation) {
        const checked = checkCancellationRows(input.cancellation);
        if (checked.error) skipped.push(checked.error);
        else {
          data.cancellation_slabs = checked.rows;
          applied++;
        }
      }
      const { error: e2 } = await supabase.from("sales_settings").update({ data }).eq("id", 1);
      if (e2) skipped.push("Payment & cancellation: " + e2.message);
    }
  }

  // new transfer rates from the Missing transfer rates sheet (checked again: places, numbers, no rate yet)
  const adds = (Array.isArray(input.newTransfers) ? input.newTransfers : []).slice(0, 2000);
  if (adds.length) {
    const [locs, rates] = await Promise.all([
      supabase.from("sales_locations").select("id").eq("active", true),
      supabase.from("sales_transfer_rates").select("from_location_id, to_location_id, active").eq("active", true),
    ]);
    const known = new Set(((locs.data ?? []) as { id: string }[]).map((l) => l.id));
    const have = [...((rates.data ?? []) as { from_location_id: string; to_location_id: string; active: boolean }[])];
    const rows = [];
    for (const t of adds) {
      const rate = Math.round(Number(t.rate));
      const capacity = Math.round(Number(t.capacity) || 4);
      const hours = t.drive_hours == null ? null : Number(t.drive_hours);
      if (!known.has(String(t.from_location_id)) || !known.has(String(t.to_location_id)) || t.from_location_id === t.to_location_id) {
        skipped.push(`Transfers: ${t.from_name} to ${t.to_name}: a place is not in Master data.`);
        continue;
      }
      if (!(rate > 0 && rate < 1_000_000) || !(capacity >= 1 && capacity <= 60) || (hours !== null && !(hours > 0 && hours < 48))) {
        skipped.push(`Transfers: ${t.from_name} to ${t.to_name}: the rate, capacity or drive time is not a sensible number.`);
        continue;
      }
      if (hasRoad(have, t.from_location_id, t.to_location_id)) {
        skipped.push(`Transfers: ${t.from_name} to ${t.to_name} already has a rate.`);
        continue;
      }
      have.push({ from_location_id: t.from_location_id, to_location_id: t.to_location_id, active: true });
      rows.push({
        from_location_id: t.from_location_id,
        to_location_id: t.to_location_id,
        vehicle_type: String(t.vehicle_type || "Toyota Innova Crysta").slice(0, 80),
        capacity,
        rate,
        drive_hours: hours,
        night_surcharge: 0,
        bidirectional: true,
        tax_pct: 0, // the sheet asks for the rate incl. GST
        notes: "Added from the Missing transfer rates sheet (rate incl. GST).",
        active: true,
      });
    }
    if (rows.length) {
      const { error } = await supabase.from("sales_transfer_rates").insert(rows);
      if (error) skipped.push("Transfers: " + error.message);
      else applied += rows.length;
    }
  }

  revalidatePath("/sales/admin", "layout");
  revalidateMasterData();
  return { ok: true, applied, skipped };
}

export async function applyRatesImport(input: { changes: Change[]; payment?: PaymentRow[] | null; cancellation?: CancellationRow[] | null; newTransfers?: NewTransfer[] | null }): Promise<ApplyResult> {
  return safe("applyRatesImport", () => applyUnsafe(input));
}
