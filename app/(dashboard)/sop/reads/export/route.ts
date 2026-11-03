import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sopEditor, loadVersion, fmtDate } from "@/lib/sop/server";
import { loadReadReport } from "@/lib/sop/reads";
import { sheetFromRows } from "@/lib/excel";

// Excel list of who has read version N and who has not (super admin).
export async function GET(req: Request) {
  const cu = await getCurrentUser();
  if (!cu?.user) return new NextResponse("Not signed in", { status: 401 });
  const g = await sopEditor();
  if ("error" in g) return new NextResponse("Only the super admin", { status: 403 });
  const n = Number(new URL(req.url).searchParams.get("v"));
  const version = await loadVersion(g.documentId, Number.isInteger(n) && n > 0 ? n : undefined);
  if (!version) return new NextResponse("No published version", { status: 404 });
  const rows = await loadReadReport(g.documentId, version.id);
  const sheet = await sheetFromRows(
    `SOP v${version.number}`,
    [["Name", "Role", "Lodges", "Read", "Read on"], ...rows.map((r) => [r.name, r.role, r.lodges, r.readAt ? "Yes" : "No", r.readAt ? fmtDate(r.readAt) : ""])],
    [28, 20, 34, 8, 22]
  );
  return new NextResponse(sheet, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="SOP-version-${version.number}-who-has-read.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
