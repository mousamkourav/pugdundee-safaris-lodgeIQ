"use server";

import { safe } from "@/lib/sales/safe";
import { getCurrentUser, isSalesAdmin, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasRoad } from "@/lib/sales/master/missing-transfers";
import { revalidateMasterData } from "@/lib/sales/master/cache";

export type SaveRateResult = { ok?: boolean; mode?: "saved" | "suggested"; rate?: number; error?: string };

// "Also save this rate in Master data" on Plan & price, for a transfer price typed by hand.
// The price typed covers all vehicles one way, incl. tax; it is saved per vehicle, for both
// directions. A Sales admin's goes straight into Transfer rates; a member's becomes a
// suggestion a Sales admin approves (Master data > Rate suggestions).
async function saveTransferRateUnsafe(input: { from: string; to: string; price: number; vehicles: number; vehicle_type: string; label?: string }): Promise<SaveRateResult> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "You do not have access to Sales." };
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  const price = Math.round(Number(input.price));
  const vehicles = Math.max(1, Math.min(20, Math.round(Number(input.vehicles) || 1)));
  const vehicle = String(input.vehicle_type ?? "").trim().slice(0, 80) || "Toyota Innova Crysta";
  // a place typed by hand ("@hotel in Delhi") is not in Master data; ids are plain words or uuids
  if (!/^[\w-]{1,64}$/.test(from) || !/^[\w-]{1,64}$/.test(to) || from === to) return { error: "This place is not in Master data, so the rate cannot be saved there. Add the place first." };
  if (!(price > 0 && price < 2_000_000)) return { error: "Type the price first." };
  const rate = Math.round(price / vehicles);

  const supabase = await createClient();
  const [locs, rates] = await Promise.all([
    supabase.from("sales_locations").select("id").in("id", [from, to]),
    supabase.from("sales_transfer_rates").select("from_location_id, to_location_id, active").eq("active", true).or(`and(from_location_id.eq.${from},to_location_id.eq.${to}),and(from_location_id.eq.${to},to_location_id.eq.${from})`),
  ]);
  if ((locs.data ?? []).length !== 2) return { error: "A place is not in Master data." };
  if (hasRoad((rates.data ?? []) as { from_location_id: string; to_location_id: string; active: boolean }[], from, to)) return { error: "This road has a rate in Master data now. Reload the plan to use it." };

  const row = { from_location_id: from, to_location_id: to, vehicle_type: vehicle, capacity: 4, rate };
  if (isSalesAdmin(cu.profile?.role)) {
    const { error } = await supabase
      .from("sales_transfer_rates")
      .insert({ ...row, night_surcharge: 0, bidirectional: true, tax_pct: 0, notes: "Saved from a quote (rate incl. tax).", active: true });
    if (error) return { error: error.message };
    revalidateMasterData();
    return { ok: true, mode: "saved", rate };
  }
  const { error } = await createAdminClient()
    .from("sales_rate_suggestions")
    .insert({ ...row, kind: "transfer", status: "suggested", example: String(input.label ?? "").slice(0, 300) || null, created_by: cu.user.id });
  if (error) return { error: /sales_rate_suggestions/.test(error.message) ? "Suggestions are not set up yet (ask the admin to run sales_rate_suggestions.sql). Your price is kept in this quote." : error.message };
  return { ok: true, mode: "suggested", rate };
}

export async function saveTransferRate(input: { from: string; to: string; price: number; vehicles: number; vehicle_type: string; label?: string }): Promise<SaveRateResult> {
  return safe("saveTransferRate", () => saveTransferRateUnsafe(input));
}
