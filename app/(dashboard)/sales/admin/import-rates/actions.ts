"use server";

import { revalidatePath } from "next/cache";
import { safe } from "@/lib/sales/safe";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEntity } from "@/lib/sales/master/entities";
import { RATE_SHEETS, fromCell, isEditable, sameValue, toCell, type CancellationRow, type PaymentRow } from "@/lib/sales/master/rates-sheet";
import { checkCancellationRows, checkPaymentRows } from "@/lib/sales/master/slabs";

type Change = { entity: string; id: string; field: string; old: unknown; new: unknown };
export type ApplyResult = { ok?: boolean; error?: string; applied?: number; skipped?: string[] };

// Applies the changes shown on the import page. Every value is checked again
// here (the browser is not trusted), and a value someone changed in LodgeIQ
// since the preview is not overwritten.
async function applyUnsafe(input: {
  changes: Change[];
  payment?: PaymentRow[] | null;
  cancellation?: CancellationRow[] | null;
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

  revalidatePath("/sales/admin", "layout");
  return { ok: true, applied, skipped };
}

export async function applyRatesImport(input: { changes: Change[]; payment?: PaymentRow[] | null; cancellation?: CancellationRow[] | null }): Promise<ApplyResult> {
  return safe("applyRatesImport", () => applyUnsafe(input));
}
