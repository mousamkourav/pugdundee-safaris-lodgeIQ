import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sopActor, loadVersion, loadVersionFull, fmtDay, SOP_BUCKET } from "@/lib/sop/server";
import { buildSopPdf, type PdfImage } from "@/lib/sop/pdf";
import { imageSize } from "@/lib/sop/image-size";
import type { PMNode } from "@/lib/sop/types";

export const maxDuration = 60;

// "Download PDF" of the current published version (?v=N: an old version, super admin only).
export async function GET(req: Request) {
  const cu = await getCurrentUser();
  if (!cu?.user) return new NextResponse("Not signed in", { status: 401 });
  const a = await sopActor();
  if ("error" in a) return new NextResponse("No access", { status: 403 });
  const vParam = new URL(req.url).searchParams.get("v");
  const wanted = vParam && a.status.isEditor ? Number(vParam) : undefined;
  const version = await loadVersion(a.documentId, Number.isInteger(wanted) ? wanted : undefined);
  if (!version) return new NextResponse("The SOP has not been published yet.", { status: 404 });

  const [sections, docRow] = await Promise.all([loadVersionFull(version.id), (await createClient()).from("sop_documents").select("title").eq("id", a.documentId).maybeSingle()]);
  const title = (docRow.data as { title?: string } | null)?.title ?? "Standard Operating Procedures";

  // the pictures, read from the private bucket
  const srcs = new Set<string>();
  const walk = (n: PMNode) => (n.type === "image" ? srcs.add(String(n.attrs?.src ?? "")) : (n.content ?? []).forEach(walk));
  sections.forEach((s) => (s.body?.content ?? []).forEach(walk));
  const images = new Map<string, PdfImage>();
  const admin = createAdminClient();
  for (const src of [...srcs].slice(0, 80)) {
    const path = src.replace(/^\/sop\/media\//, "");
    if (!/^images\/[A-Za-z0-9_-]+\.(png|jpe?g)$/.test(path)) continue; // the PDF takes PNG and JPG
    const { data } = await admin.storage.from(SOP_BUCKET).download(path);
    if (!data) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    const size = imageSize(bytes);
    if (size) images.set(src, { data: bytes, format: size.format, width: size.width, height: size.height });
  }

  const pdf = buildSopPdf({ title, version: version.number, published: fmtDay(version.published_at), sections, images });
  const body = new Uint8Array(pdf.output("arraybuffer"));
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Pugdundee-SOP-version-${version.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
