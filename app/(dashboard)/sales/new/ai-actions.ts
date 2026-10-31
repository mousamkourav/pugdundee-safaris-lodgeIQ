"use server";

import { safe } from "@/lib/sales/safe";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrubForAI } from "@/lib/sales/plan/parse-text";
import { loadBuilderContext, todayIST } from "@/lib/sales/plan/load-context";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import { buildPrompt, type GlossaryRow } from "@/lib/sales/plan/ai";
import { aiShouldHelp, normaliseEnquiry, pickPattern, structureOf, type ReadingPattern, type Token } from "@/lib/sales/plan/reading";
import { timed } from "@/lib/timing";

// The second reading of a chat message (lib/sales/plan/reading.ts), after the built-in
// reader has read it in the browser:
//   1. memory: a quote already saved for the same enquiry (or the same with only dates,
//      numbers or names changed). No AI call.
//   2. Gemini, only for what the checklist still misses, and only when the message has
//      words the reader could not place. It may fill gaps; it never overrides the reader
//      (fillGaps, in the browser). Used when Sales settings has "AI reading" on and
//      GEMINI_API_KEY is set in Vercel (never in the DB).
// Guest names, emails and phone numbers are removed before anything is sent or saved.
// Any failure (no key, credit run out, limit reached, timeout, odd answer) leaves the
// built-in reader's reading in place: the assistant always keeps working.

// GEMINI_MODEL in Vercel (the owner sets gemini-3.1-flash-lite). Thinking off, temperature 0,
// JSON out, 20 s per try, one retry when Google is busy (429 / 503). The page allows 60 s.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const TIMEOUT_MS = 20_000;
const RETRY_AFTER_MS = 1_500;

export async function aiEnabled(): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("sales_settings").select("data").eq("id", 1).maybeSingle();
    return !!((data as { data?: { ai_parsing_enabled?: boolean } } | null)?.data?.ai_parsing_enabled);
  } catch {
    return false; // AI is optional: if the setting cannot be read, carry on without it
  }
}

const UNAVAILABLE = "The AI is not available right now (busy, or its credit has run out); the built-in reader was used.";

async function callGemini(prompt: string): Promise<{ json?: unknown; error?: string }> {
  const key = process.env.GEMINI_API_KEY!;
  // "thinking" off: a model that does not allow switching it off is asked once more without it
  let thinkingOff = true;
  let retried = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
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
        await new Promise((ok) => setTimeout(ok, RETRY_AFTER_MS));
        continue;
      }
      if (res.status === 404) return { error: `The AI model "${MODEL}" was not found (GEMINI_MODEL in Vercel); the built-in reader was used.` };
      if (res.status === 429 || res.status === 503 || res.status === 402 || res.status === 403) return { error: UNAVAILABLE };
      if (!res.ok) return { error: `The AI service answered ${res.status}; the built-in reader was used.` };
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const out = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return { json: JSON.parse(out.replace(/^```(?:json)?|```$/g, "").trim()) };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return { error: aborted ? "The AI took too long; the built-in reader was used." : "The AI reply could not be read; the built-in reader was used." };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: UNAVAILABLE };
}

export interface AssistInput {
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
  planJson: string;
  gaps: string[]; // the checklist questions still open after the built-in reader
  unknownWords: string[]; // words in the message the reader could not place
  wantAI: boolean; // the browser's decision (aiShouldHelp); checked again here
}
export interface AssistResult {
  source: "memory" | "ai" | "reader";
  reading?: unknown; // the AI answer shape; the browser maps it with aiToParsed (checked against master data)
  error?: string;
}

async function assistReadingUnsafe(input: AssistInput): Promise<AssistResult> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { source: "reader", error: "No access." };
  const plan = sanitizePlan(JSON.parse(input.planJson));
  if (!plan) return { source: "reader", error: "The trip could not be read." };
  const message = String(input.message ?? "").slice(0, 4000);
  const supabase = await createClient();
  const { ctx } = await loadBuilderContext();
  const today = todayIST();
  const gaps = (Array.isArray(input.gaps) ? input.gaps : []).filter((g): g is string => typeof g === "string").slice(0, 12);

  // 1. memory: only for an enquiry typed into an empty trip (that is what was saved)
  if (!plan.stops.length && message.trim().length >= 15) {
    const key = normaliseEnquiry(message, ctx.readerRules ?? [], [plan.guest.name]);
    const { structure, tokens } = structureOf(key, today);
    const { data, error } = await supabase.from("sales_reading_patterns").select("id, key, structure, tokens, reading, hits").eq("structure", structure).limit(20);
    if (!error && data?.length) {
      const rows = (data as { id: string; key: string; structure: string; tokens: Token[]; reading: Record<string, unknown>; hits: number }[]).map(
        (r): ReadingPattern => ({ ...r, tokens: Array.isArray(r.tokens) ? r.tokens : [] })
      );
      const hit = pickPattern(rows, key, tokens, today);
      if (hit) {
        // counted with the service key (members cannot change patterns); never blocks the reply
        await createAdminClient()
          .from("sales_reading_patterns")
          .update({ hits: (hit.pattern.hits ?? 0) + 1, last_used_at: new Date().toISOString() })
          .eq("id", hit.pattern.id!)
          .then(() => undefined, () => undefined);
        await log(supabase, { userId: cu.user.id, message: key, result: hit.reading, source: "memory", ms: 0, gaps });
        return { source: "memory", reading: hit.reading };
      }
    }
  }

  // 2. the AI, only for gaps, and only when it may help
  const unknown = (Array.isArray(input.unknownWords) ? input.unknownWords : []).filter((w): w is string => typeof w === "string").slice(0, 20);
  if (!input.wantAI || !aiShouldHelp({ gaps, unknownWords: unknown, stops: plan.stops.length || 1 }) || !(await aiEnabled())) return { source: "reader" };

  const gl = await supabase.from("sales_glossary").select("term, meaning").eq("active", true).limit(300);
  const glossary = ((gl.data ?? []) as GlossaryRow[]).filter((g) => g.term && g.meaning);
  // what the AI is told: the message, the gaps, our master data (no past quotes: those are the memory now)
  const prompt = buildPrompt({ message, history: (input.history ?? []).slice(-8), plan, ctx, glossary, examples: [], today, gaps });
  const started = Date.now();
  const res = await callGemini(prompt);
  await log(supabase, { userId: cu.user.id, message: scrubForAI(message, [plan.guest.name]), result: res.json ?? null, error: res.error, source: "ai", ms: Date.now() - started, gaps, model: MODEL });
  if (res.error || res.json === undefined) return { source: "reader", error: res.error ?? "No answer from the AI." };
  return { source: "ai", reading: res.json };
}

// sales_chat_log: what was read, by what, how long it took (no names, emails or phone
// numbers). Before sales_reading_patterns.sql the new columns are missing: then the old row.
async function log(
  supabase: Awaited<ReturnType<typeof createClient>>,
  e: { userId: string; message: string; result: unknown; error?: string; source: "memory" | "ai"; ms: number; gaps: string[]; model?: string }
) {
  const row = { created_by: e.userId, message: e.message.slice(0, 2000), result: e.result ?? null, error: e.error ?? null, model: e.model ?? null };
  const full = await supabase.from("sales_chat_log").insert({ ...row, source: e.source, duration_ms: e.ms, gaps: e.gaps.length ? e.gaps : null });
  if (full.error) await supabase.from("sales_chat_log").insert(row).then(() => undefined, () => undefined);
}

// Public action: any unexpected failure comes back as { error } and the reader's reading stays.
export async function assistReading(input: AssistInput): Promise<AssistResult> {
  return timed("assistReading", async () => {
    const r = await safe("assistReading", () => assistReadingUnsafe(input));
    return "source" in r ? r : { source: "reader" as const, error: r.error };
  });
}
