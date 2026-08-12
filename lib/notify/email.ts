import { Resend } from "resend";

// Sends an email via Resend. If RESEND_API_KEY isn't set, it no-ops (returns false)
// so the app works before email is configured.
export async function sendEmail(
  to: string[],
  subject: string,
  html: string
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || to.length === 0) {
    console.log("[email] skipped (no API key or no recipients):", subject);
    return false;
  }
  const from = process.env.EMAIL_FROM || "LodgeIQ <onboarding@resend.dev>";
  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({ from, to, subject, html });
    if (error) {
      console.error("[email] send error:", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] exception:", e);
    return false;
  }
}
