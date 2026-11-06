"use server";

// The Red Panda trip assistant on the server: the built-in Red Panda reader, and the AI (Gemini)
// first when Sales settings has "AI reading" on and GEMINI_API_KEY is set in Vercel. Every AI
// value must pass the evidence rule (lib/redpanda/ai.ts); names, emails and phone numbers never
// leave the server. Each AI call is written to sales_chat_log (message without names).
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { safe } from "@/lib/sales/safe";
import { todayIST } from "@/lib/sales/plan/load-context";
import { rpActor } from "@/lib/redpanda/server";
import { readEnquiry, type RpPending, type RpReading } from "@/lib/redpanda/reader";
import { checkRpEvidence, mergeReadings, rpPrompt, scrubRp, type RpDropped } from "@/lib/redpanda/ai";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const TIMEOUT_MS = 20_000;

async function guard(): Promise<{ error: string } | { userId: string }> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "You do not have access to Sales." };
  const a = await rpActor();
  if ("error" in a) return a;
  return { userId: a.userId };
}

async function aiOn(): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return false;
  try {
    const { data } = await (await createClient()).from("sales_settings").select("data").eq("id", 1).maybeSingle();
    return !!((data as { data?: { ai_parsing_enabled?: boolean } } | null)?.data?.ai_parsing_enabled);
  } catch {
    return false;
  }
}

async function callGemini(prompt: string): Promise<{ json?: unknown; error?: string }> {
  let thinkingOff = true;
  let retried = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0, ...(thinkingOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 400 && thinkingOff) {
        thinkingOff = false;
        continue;
      }
      if ((res.status === 429 || res.status === 503) && !retried) {
        retried = true;
        await new Promise((ok) => setTimeout(ok, 1500));
        continue;
      }
      if (!res.ok) return { error: `The AI answered ${res.status}; the built-in reader was used.` };
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const out = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return { json: JSON.parse(out.replace(/^```(?:json)?|```$/g, "").trim()) };
    } catch (e) {
      return { error: e instanceof Error && e.name === "AbortError" ? "The AI took too long; the built-in reader was used." : "The AI reply could not be read; the built-in reader was used." };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "The AI is not available right now; the built-in reader was used." };
}

export interface RpAssistResult {
  reading?: RpReading;
  source?: "ai" | "reader";
  note?: string; // where the reading came from, for the chat
  error?: string;
}

export async function rpAssist(input: { message: string; pending: RpPending; guestName: string; hotelRooms: string[] }): Promise<RpAssistResult> {
  return safe("red panda assist", async () => {
    const g = await guard();
    if ("error" in g) return g;
    const message = String(input?.message ?? "").slice(0, 4000);
    if (!message.trim()) return { error: "Type the enquiry." };
    const rooms = Array.isArray(input.hotelRooms) ? input.hotelRooms.map(String).slice(0, 10) : [];
    const pending = (["arrival", "adults", "nationality", "nights", "ages", "hotel_side", "hotel_room"] as const).find((p) => p === input.pending) ?? null;
    const today = todayIST();
    const reader = readEnquiry(message, today, { pending, hotelRooms: rooms });

    // a short reply to the assistant's own question: the reader reads it (no AI call)
    const short = !!pending && message.trim().split(/\s+/).length <= 4;
    if (short || !(await aiOn())) return { reading: reader, source: "reader", note: short ? "" : "Read by the built-in reader (AI reading is off)." };

    const names = [String(input.guestName ?? ""), reader.name ?? ""].filter(Boolean);
    const sent = scrubRp(message, names);
    const t0 = Date.now();
    const ai = await callGemini(rpPrompt(sent, today, rooms));
    let dropped: RpDropped[] = [];
    let result: RpAssistResult;
    if (ai.error || ai.json === undefined) result = { reading: reader, source: "reader", note: ai.error ?? "The built-in reader was used." };
    else {
      const checked = checkRpEvidence(ai.json, sent, rooms);
      dropped = checked.dropped;
      const merged = mergeReadings(checked.reading, reader);
      result = { reading: merged.reading, source: "ai", note: `Read by the AI${merged.added.length ? `; the built-in reader added: ${merged.added.join(", ")}` : ""}.` };
    }
    // the log: what was read and by what (the message without names, emails or phones)
    try {
      const supabase = await createClient();
      const row = { created_by: g.userId, message: `[Red Panda] ${sent}`.slice(0, 2000), result: result.reading ?? null, error: ai.error ?? null, model: MODEL };
      const gaps = dropped.map((d) => `${d.field}: ${d.reason}`).slice(0, 40);
      const full = await supabase.from("sales_chat_log").insert({ ...row, source: "ai", duration_ms: Date.now() - t0, gaps: gaps.length ? gaps : null });
      if (full.error) await supabase.from("sales_chat_log").insert(row);
    } catch {
      // the log is optional
    }
    // contact details read from the original message (never sent out)
    return result;
  });
}
