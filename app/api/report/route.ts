import { NextResponse } from "next/server";
import { sheetFromRows } from "@/lib/excel";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { monthRange } from "@/lib/format";
import { computeDerived, getPath, sectionsForLodge } from "@/lib/monthly";

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Excel export of ONE lodge+month, built from the same monthly_submissions
// JSONB (and the same section config) as the Detailed report page, so the
// download always matches what is on screen. It used to read the old
// relational tables (occupancy_daily, payroll, ...), which the monthly form
// never writes, so the export showed zeros / different numbers.
function cell(raw: unknown): string | number {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "number") return raw;
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

export async function GET(request: Request) {
  // signed in and not deactivated
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = await createClient();

  const { searchParams } = new URL(request.url);
  const lodge = searchParams.get("lodge");
  const month = searchParams.get("month");
  if (!lodge || !month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
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
  const name = (lodgeRow as { name: string }).name;

  const { start, label } = monthRange(month);
  const { data: row, error } = await supabase
    .from("monthly_submissions")
    .select("data, status")
    .eq("lodge_id", lodge)
    .eq("month", start)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const data = row ? computeDerived(((row as any).data ?? {}) as Record<string, unknown>) : {};

  const rows: (string | number)[][] = [
    ["Pugdundee Safaris - Monthly Report"],
    ["Lodge", name],
    ["Month", label],
    ["Status", row ? String((row as any).status ?? "") : "No report"],
  ];

  for (const sec of sectionsForLodge(name)) {
    rows.push([], [sec.title]);
    for (const f of sec.fields ?? []) {
      rows.push([f.label + (f.unit === "money" ? " (Rs)" : ""), cell(getPath(data, f.path))]);
    }
    for (const b of sec.arrays ?? []) {
      const list = (Array.isArray((data as any)[b.path]) ? (data as any)[b.path] : []) as any[];
      rows.push([b.label]);
      if (list.length === 0) {
        rows.push(["None recorded"]);
        continue;
      }
      rows.push(b.columns.map((c) => c.label + (c.unit === "money" ? " (Rs)" : "")));
      for (const r of list) {
        if (!r || typeof r !== "object") continue;
        rows.push(b.columns.map((c) => cell(r[c.key])));
      }
    }
  }

  const ab = await sheetFromRows("Monthly Report", rows, [36, 22, 22, 18, 18, 18, 18]);

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
