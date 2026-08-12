import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { getMonthlySummary } from "@/lib/report";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const lodge = searchParams.get("lodge");
  const month = searchParams.get("month");
  if (!lodge || !month) {
    return NextResponse.json({ error: "missing lodge or month" }, { status: 400 });
  }

  // RLS ensures the user can only pull a lodge they may access.
  const { data: lodgeRow } = await supabase
    .from("lodges")
    .select("name")
    .eq("id", lodge)
    .maybeSingle();
  if (!lodgeRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const sm = await getMonthlySummary(supabase, lodge, month);
  const name = (lodgeRow as { name: string }).name;

  const rows: (string | number)[][] = [
    ["Pugdundee Safaris — Monthly Report"],
    ["Lodge", name],
    ["Month", sm.label],
    [],
    ["Occupancy & revenue"],
    ["Rooms paid", sm.roomsPaid],
    ["Rooms comp", sm.roomsComp],
    ["Room nights", sm.roomNights],
    ["Total pax", sm.pax],
    ["Extra sales (Rs)", sm.extrasTotal],
    ["TripAdvisor", sm.tripadvisor ?? ""],
    ["Google", sm.google ?? ""],
    [],
    ["Costs"],
    ["F&B (Rs)", sm.fnb],
    ["Misc (Rs)", sm.misc],
    ["Housekeeping (Rs)", sm.hk],
    ["Total F&B+Misc+HK (Rs)", sm.totalExpenses],
    ["F&B per guest (Rs)", sm.fnbPerPax ?? ""],
    ["F&B per room (Rs)", sm.fnbPerRoom ?? ""],
    [],
    ["Energy & vehicles"],
    ["Energy cost (Rs)", sm.energyCost],
    ["Fuel used (L)", Math.round(sm.fuelLitres)],
    ["Vehicle cost (Rs)", sm.vehicleCost],
    ["Vehicle km", Math.round(sm.vehicleKm)],
    [],
    ["People, stock & compliance"],
    ["Payroll net (Rs)", sm.payrollNet],
    ["Purchases (Rs)", sm.purchasesTotal],
    ["Low-stock items", sm.lowStock],
    ["Overdue services", sm.overdue],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 28 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Monthly Report");
  const ab = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const fname = `${name.replace(/[^\w]+/g, "_")}_${month}.xlsx`;
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
