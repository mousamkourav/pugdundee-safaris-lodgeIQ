// Opens a payment's attachment: only for someone who may see the payment (row level security
// decides), through a short-lived link to the private bucket.
import { NextResponse } from "next/server";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return NextResponse.json({ error: "You do not have access." }, { status: 403 });
  const id = new URL(req.url).searchParams.get("p") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("sales_booking_payments").select("attachment_path").eq("id", id).maybeSingle();
  const path = (data as { attachment_path: string | null } | null)?.attachment_path;
  if (!path) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { data: signed, error } = await createAdminClient().storage.from("sales-payments").createSignedUrl(path, 60);
  if (error || !signed) return NextResponse.json({ error: "The file could not be opened." }, { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
