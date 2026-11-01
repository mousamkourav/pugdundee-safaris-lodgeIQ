"use server";

import { safe } from "@/lib/sales/safe";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrubForAI } from "@/lib/sales/plan/parse-text";
import { loadBuilderContext, todayIST } from "@/lib/sales/plan/load-context";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import { buildPrompt, similarExamples, type Example, type GlossaryRow } from "@/lib/sales/plan/ai";
import { checkEvidence, type Dropped } from "@/lib/sales/plan/evidence";
import { normaliseEnquiry, pickPattern, structureOf, type ReadingPattern, type Token } from "@/lib/sales/plan/reading";
import { timed } from "@/lib/timing";

// The reading of a chat message, AI first (lib/sales/plan/reading.ts):
//   1. memory: a quote already saved for the same enquiry (or the same with only dates,
//      numbers or names changed). No AI call.
//   2. Gemini, for every message the browser sends (a short reply to the assistant's own
//      question is read in the browser and never sent). Each value must quote the words of
//      the message that say it: checkEvidence keeps only those (evidence.ts), here on the
//      server, so a value without evidence never reaches the trip. The built-in reader then
//      fills, in the browser, only what the AI left empty (mergeAiFirst).
//   Used when Sales settings has "AI reading" on and GEMINI_API_KEY is set in Vercel (never
//   in the DB). Any failure (no key, credit run out, limit reached, timeout, odd answer)
//   gives { source: "reader" }: the built-in reader reads the message, the assistant goes on.
// Guest names, emails and phone numbers are removed before anything is sent or saved.

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
}
export interface AssistResult {
  source: "memory" | "ai" | "reader";
  // memory: a saved reading; ai: the AI's values that passed the evidence rule. Both in the
  // plain shape the browser maps with aiToParsed (checked against Master data).
  reading?: unknown;
  dropped?: number; // AI values thrown away (no quote, or the quote does not say it)
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
        await log(supabase, { userId: cu.user.id, message: key, result: hit.reading, source: "memory", ms: 0 });
        return { source: "memory", reading: hit.reading };
      }
    }
  }

  // 2. the AI, for the whole message
  if (!(await aiEnabled())) return { source: "reader" };
  const [gl, pt] = await Promise.all([
    supabase.from("sales_glossary").select("term, meaning").eq("active", true).limit(300),
    // similar enquiries this team quoted (Reading memory): for understanding, never as values
    supabase.from("sales_reading_patterns").select("key, reading").order("last_used_at", { ascending: false, nullsFirst: false }).limit(300),
  ]);
  const glossary = ((gl.data ?? []) as GlossaryRow[]).filter((g) => g.term && g.meaning);
  const said = scrubForAI(message, [plan.guest.name]);
  const saved = ((pt.error ? [] : pt.data ?? []) as { key: string; reading: unknown }[]).map((r): Example => ({ message: r.key, expected: JSON.stringify(r.reading) }));
  const examples = similarExamples(saved, normaliseEnquiry(said, ctx.readerRules ?? []), 3);
  const prompt = buildPrompt({ message, history: (input.history ?? []).slice(-8), plan, ctx, glossary, examples, today });
  const started = Date.now();
  const res = await callGemini(prompt);
  if (res.error || res.json === undefined) {
    await log(supabase, { userId: cu.user.id, message: said, result: null, error: res.error, source: "ai", ms: Date.now() - started, model: MODEL });
    return { source: "reader", error: res.error ?? "No answer from the AI." };
  }
  // the evidence rule: a value the message does not say is dropped here, never guessed
  const { reading, dropped } = checkEvidence(res.json, said, ctx);
  await log(supabase, { userId: cu.user.id, message: said, result: { answer: res.json, kept: reading, dropped }, source: "ai", ms: Date.now() - started, model: MODEL, dropped });
  return { source: "ai", reading, dropped: dropped.length };
}

// sales_chat_log: what was read, by what, how long it took, what the evidence rule dropped
// (no names, emails or phone numbers). Before sales_reading_patterns.sql the new columns are
// missing: then the old row.
async function log(
  supabase: Awaited<ReturnType<typeof createClient>>,
  e: { userId: string; message: string; result: unknown; error?: string; source: "memory" | "ai"; ms: number; model?: string; dropped?: Dropped[] }
) {
  const row = { created_by: e.userId, message: e.message.slice(0, 2000), result: e.result ?? null, error: e.error ?? null, model: e.model ?? null };
  // the "gaps" column now lists the AI values the evidence rule dropped (field: reason)
  const gaps = (e.dropped ?? []).map((d) => `${d.field}: ${d.reason}`).slice(0, 40);
  const full = await supabase.from("sales_chat_log").insert({ ...row, source: e.source, duration_ms: e.ms, gaps: gaps.length ? gaps : null });
  if (full.error) await supabase.from("sales_chat_log").insert(row).then(() => undefined, () => undefined);
}

// Public action: any unexpected failure comes back as { source: "reader" } and the reader reads.
export async function assistReading(input: AssistInput): Promise<AssistResult> {
  return timed("assistReading", async () => {
    const r = await safe("assistReading", () => assistReadingUnsafe(input));
    return "source" in r ? r : { source: "reader" as const, error: r.error };
  });
}
