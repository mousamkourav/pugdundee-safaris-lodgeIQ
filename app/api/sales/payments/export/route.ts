// The Payments list as Excel (the same filters as the screen). Sales users; each sees only the
// bookings they may see (row level security).
import { NextResponse } from "next/server";
import { getCurrentUser, isSalesUser, isSalesAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadBookings } from "@/lib/sales/payments/server";
import { filterBookings, readFilters } from "@/lib/sales/payments/filters";
import { buildPaymentsWorkbook, exportRows } from "@/lib/sales/payments/export";
import { getMemberNames } from "@/lib/sales/members";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const cu = await getCurrentUser();
  if (!cu?.user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSalesUser(cu.profile?.role)) return NextResponse.json({ error: "You do not have access to Sales." }, { status: 403 });
  const supabase = await createClient();
  const { bookings, error } = await loadBookings(supabase);
  if (error) return NextResponse.json({ error: "Could not read the payments." }, { status: 500 });
  const now = new Date(Date.now() + 330 * 60_000);
  const today = now.toISOString().slice(0, 10);
  const f = readFilters(Object.fromEntries(new URL(req.url).searchParams));
  const rows = filterBookings(bookings, isSalesAdmin(cu.profile?.role) ? f : { ...f, owner: "" }, today);
  const { names } = await getMemberNames(rows.map((b) => b.owner_id).filter((x): x is string => !!x));
  const exportedAt = now.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  const buf = await buildPaymentsWorkbook(exportRows(rows, today, names), { exportedAt, exportedBy: cu.profile?.full_name || "LodgeIQ" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Payments ${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
