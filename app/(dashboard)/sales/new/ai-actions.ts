"use server";

import { safe } from "@/lib/sales/safe";
import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { scrubForAI, type ParsedTrip } from "@/lib/sales/plan/parse-text";
import { loadBuilderContext, todayIST } from "@/lib/sales/plan/load-context";
import { sanitizePlan } from "@/lib/sales/plan/sanitize";
import { aiToParsed, buildPrompt, similarExamples, type Example, type GlossaryRow } from "@/lib/sales/plan/ai";

// The AI trip assistant (Google Gemini). Used when:
//   - Sales settings has "AI reading of trip descriptions" switched on, and
//   - GEMINI_API_KEY is set in the server environment (Vercel), never in the DB.
// Guest names, emails and phone numbers are removed before sending. Gemini's
// answer is checked against master data (lib/sales/plan/ai.ts); prices always come
// from our own engine. Any failure (no key, limit reached, timeout, odd answer)
// returns an error and the built-in reader's result is used instead.

const TIMEOUT_MS = 12_000;
// Your chosen model first (GEMINI_MODEL in Vercel), then Google's always-current
// Flash model, then a fixed one: a model being retired never breaks the assistant.
const MODELS = [...new Set([process.env.GEMINI_MODEL, "gemini-flash-latest", "gemini-2.5-flash"].filter((m): m is string => !!m))];

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

async function callGemini(prompt: string): Promise<{ json?: unknown; error?: string; model?: string }> {
  const key = process.env.GEMINI_API_KEY!;
  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0 },
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 404) continue; // model not available: try the next one
      if (res.status === 429) return { error: "The AI's free limit is reached for this minute; the built-in reader was used." };
      if (!res.ok) return { error: `The AI service answered ${res.status}; the built-in reader was used.` };
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const out = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return { json: JSON.parse(out.replace(/^```(?:json)?|```$/g, "").trim()), model };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return { error: aborted ? "The AI took too long; the built-in reader was used." : "The AI reply could not be read; the built-in reader was used." };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: "No AI model is available with this key; the built-in reader was used." };
}

// Reads one chat message with Gemini, in the light of the conversation and the trip so far.
async function aiUnderstandUnsafe(input: { message: string; history: { role: "user" | "assistant"; text: string }[]; planJson: string }): Promise<{ parsed?: ParsedTrip; error?: string }> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "No access." };
  if (!(await aiEnabled())) return { error: "The AI assistant is switched off." };
  const plan = sanitizePlan(JSON.parse(input.planJson));
  if (!plan) return { error: "The trip could not be read." };

  const supabase = await createClient();
  const { ctx } = await loadBuilderContext();
  // the team's glossary and similar quotes already made (tables may not exist yet: then none)
  const [gl, ex] = await Promise.all([
    supabase.from("sales_glossary").select("term, meaning").eq("active", true).limit(300),
    supabase.from("sales_chat_examples").select("message, expected").eq("active", true).order("created_at", { ascending: false }).limit(300),
  ]);
  const glossary = ((gl.data ?? []) as GlossaryRow[]).filter((g) => g.term && g.meaning);
  const examples = similarExamples(((ex.data ?? []) as Example[]).filter((e) => e.message && e.expected), input.message, 3);

  const prompt = buildPrompt({ message: input.message, history: input.history.slice(-8), plan, ctx, glossary, examples, today: todayIST() });
  const res = await callGemini(prompt);
  // keep a log (no names, emails or phone numbers) to see what the assistant misreads
  await supabase
    .from("sales_chat_log")
    .insert({ created_by: cu.user.id, message: scrubForAI(input.message), result: res.json ?? null, error: res.error ?? null, model: res.model ?? null })
    .then(() => undefined, () => undefined);
  if (res.error || res.json === undefined) return { error: res.error ?? "No answer from the AI." };
  return { parsed: aiToParsed(res.json, ctx) };
}

// Public action: any unexpected failure comes back as { error }.
export async function aiUnderstand(input: { message: string; history: { role: "user" | "assistant"; text: string }[]; planJson: string }): Promise<{ parsed?: ParsedTrip; error?: string }> {
  return safe("aiUnderstand", () => aiUnderstandUnsafe(input));
}
