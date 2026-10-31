// Reads an edited rates workbook and returns what would change (old -> new).
// Nothing is saved here: the import page applies the changes after confirmation.
import { NextResponse } from "next/server";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { compareWorkbook } from "@/lib/sales/master/rates-data";
import { readRatesWorkbook } from "@/lib/sales/master/rates-workbook";
import { readMissingTransfersWorkbook } from "@/lib/sales/master/missing-transfers-workbook";
import { hasRoad } from "@/lib/sales/master/missing-transfers";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesAdmin(cu.profile?.role)) return NextResponse.json({ error: "Only Sales admins can import rates." }, { status: 403 });
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "Choose the Excel file first." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "The file is too large (over 4 MB). Is it the rates export?" }, { status: 400 });
    if (!/\.xlsx$/i.test(file.name)) return NextResponse.json({ error: "Choose an Excel .xlsx file (the one from Export all rates)." }, { status: 400 });
    const buf = await file.arrayBuffer();
    // the filled "Missing transfer rates" sheet: new rates to add (shown first, added on Apply)
    const missing = await readMissingTransfersWorkbook(buf);
    if (missing) {
      const supabase = await createClient();
      const [locs, rates] = await Promise.all([
        supabase.from("sales_locations").select("id").eq("active", true),
        supabase.from("sales_transfer_rates").select("from_location_id, to_location_id, active").eq("active", true),
      ]);
      const known = new Set(((locs.data ?? []) as { id: string }[]).map((l) => l.id));
      const have = (rates.data ?? []) as { from_location_id: string; to_location_id: string; active: boolean }[];
      const notes: string[] = [];
      const rows = missing.rows.filter((r) => {
        if (!known.has(r.from_location_id) || !known.has(r.to_location_id)) return void notes.push(`Row ${r.line}: ${r.from_name} or ${r.to_name} is no longer in Master data, so it was left out.`);
        if (hasRoad(have, r.from_location_id, r.to_location_id)) return void notes.push(`Row ${r.line}: ${r.from_name} to ${r.to_name} has a rate now, so it was left out.`);
        return true;
      });
      return NextResponse.json({ changes: [], problems: missing.problems, notes, newTransfers: rows });
    }
    const read = await readRatesWorkbook(buf);
    if (read.problem) return NextResponse.json({ error: read.problem }, { status: 400 });
    return NextResponse.json(await compareWorkbook(read));
  } catch (e) {
    console.error("[sales] rates import preview failed:", e);
    return NextResponse.json({ error: "The file could not be read. Make sure it is the rates export saved as .xlsx." }, { status: 500 });
  }
}
