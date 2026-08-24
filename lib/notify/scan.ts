import { createAdminClient } from "@/lib/supabase/admin";
import { recipientsForLodge } from "./recipients";
import { sendEmail } from "./email";

const DUE_SOON_DAYS = 14; // create alerts for services due within this window
const DEDUPE_DAYS = 20; // don't recreate the same asset alert within this window
const COMPLIANCE_DUE_SOON_DAYS = 30; // insurance/licence expiry lead time
const COMPLIANCE_DEDUPE_DAYS = 20; // don't recreate the same doc alert within this window

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const today = new Date().toISOString().slice(0, 10);
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
}

export async function runScan(): Promise<{ created: number; sent: number }> {
  const admin = createAdminClient();
  let created = 0;
  let sent = 0;

  // ---- A. Create service-due / overdue notifications ----
  const { data: lodges } = await admin
    .from("lodges")
    .select("id,name")
    .eq("status", "active");
  const { data: assets } = await admin
    .from("assets")
    .select("id,lodge_id,name,criticality");
  const { data: services } = await admin
    .from("service_records")
    .select("asset_id,next_due,service_date")
    .order("service_date", { ascending: false });

  const latest = new Map<string, { next_due: string | null }>();
  for (const s of (services ?? []) as Array<{
    asset_id: string;
    next_due: string | null;
  }>) {
    if (!latest.has(s.asset_id)) latest.set(s.asset_id, s);
  }
  const lodgeName = new Map<string, string>();
  for (const l of (lodges ?? []) as Array<{ id: string; name: string }>) {
    lodgeName.set(l.id, l.name);
  }

  for (const a of (assets ?? []) as Array<{
    id: string;
    lodge_id: string;
    name: string;
    criticality: string;
  }>) {
    const last = latest.get(a.id);
    const due = last?.next_due ?? null;
    const d = daysUntil(due);
    if (due === null || d === null || d > DUE_SOON_DAYS) continue;

    const sinceIso = new Date(
      Date.now() - DEDUPE_DAYS * 86400000
    ).toISOString();
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("type", "service_due")
      .eq("lodge_id", a.lodge_id)
      .gte("created_at", sinceIso)
      .filter("extra->>asset_id", "eq", a.id)
      .limit(1);
    if (existing && existing.length) continue;

    const overdue = d < 0;
    const severity =
      a.criticality === "safety" ? "critical" : overdue ? "warning" : "info";
    const where = lodgeName.get(a.lodge_id) ?? "lodge";
    const title = `${overdue ? "Overdue" : "Due soon"}: ${a.name}`;
    const body = overdue
      ? `${a.name} at ${where} is ${Math.abs(d)} day(s) overdue for service (due ${due}).`
      : `${a.name} at ${where} is due for service in ${d} day(s) (due ${due}).`;

    await admin.from("notifications").insert({
      lodge_id: a.lodge_id,
      type: "service_due",
      severity,
      title,
      body,
      channels: ["inapp", "email"],
      status: "pending",
      extra: { asset_id: a.id },
    });
    created++;
  }

  // ---- A2. Create insurance / licence expiry notifications ----
  // Fires when a document expires within COMPLIANCE_DUE_SOON_DAYS (or is already
  // expired). Uses the same notification shape + dedupe pattern as services, so
  // these are emailed by step B automatically.
  const { data: docs } = await admin
    .from("compliance_documents")
    .select("id,lodge_id,doc_type,title,expiry_date");

  for (const doc of (docs ?? []) as Array<{
    id: string;
    lodge_id: string;
    doc_type: string;
    title: string;
    expiry_date: string | null;
  }>) {
    const d = daysUntil(doc.expiry_date);
    if (doc.expiry_date === null || d === null || d > COMPLIANCE_DUE_SOON_DAYS)
      continue;

    const sinceIso = new Date(
      Date.now() - COMPLIANCE_DEDUPE_DAYS * 86400000
    ).toISOString();
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("type", "compliance_expiry")
      .eq("lodge_id", doc.lodge_id)
      .gte("created_at", sinceIso)
      .filter("extra->>doc_id", "eq", doc.id)
      .limit(1);
    if (existing && existing.length) continue;

    const expired = d < 0;
    const kind = doc.doc_type === "licence" ? "Licence" : "Insurance";
    const where = lodgeName.get(doc.lodge_id) ?? "lodge";
    const severity = expired ? "critical" : "warning";
    const title = `${expired ? "Expired" : "Expiring soon"}: ${doc.title}`;
    const body = expired
      ? `${kind} "${doc.title}" at ${where} expired ${Math.abs(d)} day(s) ago (on ${doc.expiry_date}).`
      : `${kind} "${doc.title}" at ${where} expires in ${d} day(s) (on ${doc.expiry_date}).`;

    await admin.from("notifications").insert({
      lodge_id: doc.lodge_id,
      type: "compliance_expiry",
      severity,
      title,
      body,
      channels: ["inapp", "email"],
      status: "pending",
      extra: { doc_id: doc.id },
    });
    created++;
  }

  // ---- B. Email all pending notifications (incl. bar rate changes) ----
  const { data: pending } = await admin
    .from("notifications")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const byLodge = new Map<string, Array<Record<string, unknown>>>();
  for (const nrow of (pending ?? []) as Array<Record<string, unknown>>) {
    const key = (nrow.lodge_id as string) ?? "global";
    if (!byLodge.has(key)) byLodge.set(key, []);
    byLodge.get(key)!.push(nrow);
  }

  for (const [lodgeId, list] of byLodge) {
    const emails =
      lodgeId === "global"
        ? []
        : (await recipientsForLodge(lodgeId)).map((r) => r.email);

    for (const nrow of list) {
      const channels = nrow.channels as string[] | null;
      const wantsEmail = Array.isArray(channels)
        ? channels.includes("email")
        : false;

      if (!wantsEmail) {
        await admin
          .from("notifications")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", nrow.id as string);
        continue;
      }
      if (emails.length === 0) continue; // no recipients yet — retry next run

      const html = `<div style="font-family:sans-serif;max-width:520px">
        <h2 style="color:#907A17;margin:0 0 8px">${nrow.title}</h2>
        <p style="color:#2E2C25;font-size:15px;line-height:1.6">${nrow.body ?? ""}</p>
        <p style="color:#837D6B;font-size:12px;margin-top:24px">LodgeIQ · Pugdundee Safaris</p>
      </div>`;
      const ok = await sendEmail(emails, `[LodgeIQ] ${nrow.title}`, html);
      if (ok) {
        sent++;
        await admin
          .from("notifications")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", nrow.id as string);
      }
    }
  }

  return { created, sent };
}
