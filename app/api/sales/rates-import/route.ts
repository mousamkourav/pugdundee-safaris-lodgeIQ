// Reads an edited rates workbook and returns what would change (old -> new).
// Nothing is saved here: the import page applies the changes after confirmation.
import { NextResponse } from "next/server";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { compareWorkbook } from "@/lib/sales/master/rates-data";
import { readRatesWorkbook } from "@/lib/sales/master/rates-workbook";

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
    const read = await readRatesWorkbook(await file.arrayBuffer());
    if (read.problem) return NextResponse.json({ error: read.problem }, { status: 400 });
    return NextResponse.json(await compareWorkbook(read));
  } catch (e) {
    console.error("[sales] rates import preview failed:", e);
    return NextResponse.json({ error: "The file could not be read. Make sure it is the rates export saved as .xlsx." }, { status: 500 });
  }
}
