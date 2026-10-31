// Downloads the "Missing transfer rates" sheet for management to fill in; the filled file
// goes back through Master data > Import rates from Excel. Sales admins only.
import { NextResponse } from "next/server";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { loadMissingTransfers } from "@/lib/sales/master/missing-transfers-data";
import { buildMissingTransfersWorkbook } from "@/lib/sales/master/missing-transfers-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cu = await getCurrentUser();
  if (!cu?.user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSalesAdmin(cu.profile?.role)) return NextResponse.json({ error: "Only Sales admins can export the rates." }, { status: 403 });

  const { pairs, vehicle, error } = await loadMissingTransfers();
  if (error) return NextResponse.json({ error: "Could not read the rates: " + error }, { status: 500 });
  const buf = await buildMissingTransfersWorkbook(pairs, vehicle);
  const stamp = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Pugdundee missing transfer rates ${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
