import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sopActor, SOP_BUCKET } from "@/lib/sop/server";

// A picture of the SOP: only for people who may read it. The bucket is private; this sends a
// short-lived link to the file. (The middleware skips image paths: this route checks itself.)
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const cu = await getCurrentUser();
  if (!cu?.user) return new NextResponse("Not signed in", { status: 401 });
  const a = await sopActor();
  if ("error" in a) return new NextResponse("No access", { status: 403 });
  const path = (await params).path.join("/");
  if (!/^images\/[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp)$/.test(path)) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage.from(SOP_BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "Cache-Control": "private, max-age=3000" } });
}
