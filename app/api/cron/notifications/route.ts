import { NextResponse } from "next/server";
import { runScan } from "@/lib/notify/scan";

export const dynamic = "force-dynamic";

// Called daily by Vercel Cron (see vercel.json). Vercel automatically adds
// "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET env var is set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const res = await runScan();
  return NextResponse.json({ ok: true, ...res });
}
