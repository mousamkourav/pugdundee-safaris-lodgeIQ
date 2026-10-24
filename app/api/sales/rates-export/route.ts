// Downloads every rate in Master data as one Excel workbook, for management
// review. Sales admins (and super admins) only; reads the live database.
import { NextResponse } from "next/server";
import { getCurrentUser, isSalesAdmin } from "@/lib/auth";
import { loadRatesData } from "@/lib/sales/master/rates-data";
import { buildRatesWorkbook } from "@/lib/sales/master/rates-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const cu = await getCurrentUser();
  if (!cu?.user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSalesAdmin(cu.profile?.role)) return NextResponse.json({ error: "Only Sales admins can export the rates." }, { status: 403 });

  const { sheets, payment, cancellation, error } = await loadRatesData();
  if (error) return NextResponse.json({ error: "Could not read the rates: " + error }, { status: 500 });

  const now = new Date(Date.now() + 330 * 60_000); // India time
  const exportedAt = now.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const buf = await buildRatesWorkbook({ sheets, payment, cancellation, exportedAt, exportedBy: cu.profile?.full_name || cu.user.email || "LodgeIQ" });
  const stamp = now.toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Pugdundee rates ${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
