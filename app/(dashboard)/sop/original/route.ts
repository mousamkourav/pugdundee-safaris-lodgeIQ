import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sopActor, SOP_BUCKET } from "@/lib/sop/server";

// "Download original Word file": the .docx the SOP was imported from (people with SOP access).
export async function GET() {
  const cu = await getCurrentUser();
  if (!cu?.user) return new NextResponse("Not signed in", { status: 401 });
  const a = await sopActor();
  if ("error" in a) return new NextResponse("No access", { status: 403 });
  const supabase = await createClient();
  const { data } = await supabase.from("sop_documents").select("original_path, original_name").eq("id", a.documentId).maybeSingle();
  const row = data as { original_path: string | null; original_name: string | null } | null;
  if (!row?.original_path) return new NextResponse("No Word file has been kept for this SOP.", { status: 404 });
  const name = (row.original_name || "SOP.docx").replace(/[^\w .()-]/g, "_");
  const signed = await createAdminClient().storage.from(SOP_BUCKET).createSignedUrl(row.original_path, 600, { download: name });
  if (signed.error || !signed.data) return new NextResponse("The file could not be found.", { status: 404 });
  return NextResponse.redirect(signed.data.signedUrl, 302);
}
