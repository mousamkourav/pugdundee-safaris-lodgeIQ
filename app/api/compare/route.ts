import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/server";
import { fetchMetrics, perRoom } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

const toYM = (iso: string) => iso.slice(0, 10).slice(0, 7);

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month"); // YYYY-MM

  // fetchMetrics is RLS-scoped, so a user only ever exports lodges they may see.
  const all = await fetchMetrics();
  const rows = month ? all.filter((m) => toYM(m.month) === month) : all;
  const scoped = rows.slice().sort((a, b) => b.extras - a.extras);

  const header = [
    "Lodge",
    "Month",
    "Room nights",
    "Pax",
    "Extra sales",
    "F&B",
    "Misc",
    "Housekeeping",
    "Total expenses",
    "F&B per guest",
    "Extra sales / room",
    "Expenses / room",
    "F&B / room",
    "HK / room",
    "Misc / room",
    "Energy cost",
    "Safaris",
    "Rating",
  ];

  const body = scoped.map((m) => {
    const pr = perRoom(m);
    return [
      m.lodgeName,
      toYM(m.month),
      m.roomNights,
      m.pax,
      m.extras,
      m.fnb,
      m.misc,
      m.hk,
      pr.totalExpenses,
      m.fnbPerPax || 0,
      pr.extrasPerRoom,
      pr.totalExpPerRoom,
      pr.fnbPerRoom,
      pr.hkPerRoom,
      pr.miscPerRoom,
      m.energyCost,
      m.safaris,
      m.rating ?? "",
    ];
  });

  const title = month ? `Lodge comparison — ${month}` : "Lodge comparison — all months";
  const aoa: (string | number)[][] = [
    ["Pugdundee Safaris — Lodge comparison"],
    [title],
    [],
    header,
    ...body,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 22 },
    { wch: 10 },
    ...Array(header.length - 2).fill({ wch: 15 }),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Comparison");
  const ab = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

  const fname = `lodge_comparison_${month ?? "all"}.xlsx`;
  return new NextResponse(ab, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
