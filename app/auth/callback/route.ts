import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase redirects the recovery link here with ?code=...
// We exchange it for a session cookie, then send the user to the reset form.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/reset-password";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL("/forgot-password?error=" + encodeURIComponent("Reset link is invalid or expired. Please request a new one."), url.origin)
      );
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
