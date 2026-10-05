"use server";

import { getCurrentUser, isSalesUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { scrubForAI, type ParsedTrip } from "@/lib/sales/plan/parse-text";
import { todayIST } from "@/lib/sales/plan/load-context";

// Optional fallback for the built-in reader. Used only when:
//   - Sales settings has "AI reading of trip descriptions" switched on, and
//   - GEMINI_API_KEY is set in the server environment (Vercel), never in the DB.
// Emails and phone numbers are removed before sending. Any failure (no key,
// quota used up, timeout, odd answer) returns an error and the builder simply
// keeps what the built-in reader found.

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TIMEOUT_MS = 10_000;

export async function aiEnabled(): Promise<boolean> {
  if (!process.env.GEMINI_API_KEY) return false;
  const supabase = await createClient();
  const { data } = await supabase.from("sales_settings").select("data").eq("id", 1).maybeSingle();
  return !!((data as { data?: { ai_parsing_enabled?: boolean } } | null)?.data?.ai_parsing_enabled);
}

const int = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : undefined);

function toParsed(raw: unknown): ParsedTrip {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const meal = String(o.meal_plan ?? "").toUpperCase();
  return {
    adults: int(o.adults, 1, 50),
    children: Array.isArray(o.children_ages) ? o.children_ages.map((a) => int(a, 0, 17)).filter((a): a is number => a !== undefined).slice(0, 20) : undefined,
    rooms: int(o.rooms, 1, 30),
    nationality: o.nationality === "indian" ? "indian" : o.nationality === "foreign" ? "foreign" : undefined,
    arrival_date: date(o.arrival_date),
    departure_date: date(o.departure_date),
    arrival_place: text(o.arrival_place),
    departure_place: text(o.departure_place),
    parks: (Array.isArray(o.parks) ? o.parks : [])
      .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
      .filter((p) => text(p.name))
      .map((p) => ({ name: text(p.name)!, nights: int(p.nights, 1, 60), lodge: text(p.lodge) }))
      .slice(0, 10),
    meal_plan: ["AP", "MAP", "CP", "EP"].includes(meal) ? (meal as ParsedTrip["meal_plan"]) : undefined,
    notes: ["Read with AI help. Please check the details."],
  };
}

export async function aiReadTrip(input: string): Promise<{ parsed?: ParsedTrip; error?: string }> {
  const cu = await getCurrentUser();
  if (!cu?.user || !isSalesUser(cu.profile?.role)) return { error: "No access." };
  if (!(await aiEnabled())) return { error: "AI reading is switched off." };
  const key = process.env.GEMINI_API_KEY!;

  const supabase = await createClient();
  const [{ data: parks }, { data: places }, { data: lodges }] = await Promise.all([
    supabase.from("sales_parks").select("name").eq("active", true),
    supabase.from("sales_locations").select("name").eq("active", true).neq("type", "property"),
    supabase.from("sales_properties").select("name").eq("active", true),
  ]);
  const names = (r: unknown) => ((r ?? []) as { name: string }[]).map((x) => x.name).join("; ");

  const prompt = [
    "Extract the safari trip request below into JSON. Reply with JSON only.",
    `Today is ${todayIST()}. Dates must be YYYY-MM-DD; if no year is given, use the next future date.`,
    `Park names must be copied exactly from this list: ${names(parks)}.`,
    `Arrival and departure places must be copied exactly from this list: ${names(places)}.`,
    `Lodge names, if mentioned, must be copied exactly from this list: ${names(lodges)}.`,
    'Keys: adults (number), children_ages (array of numbers), rooms (number), nationality ("indian" or "foreign"),',
    "arrival_date, departure_date, arrival_place, departure_place, parks (array of {name, nights, lodge} in travel order),",
    'meal_plan ("AP" full board, "MAP", "CP" breakfast, "EP" room only). Use null for anything not stated. Do not guess.',
    "",
    "Request:",
    scrubForAI(input),
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 429) return { error: "The AI's free quota is used up for now. The built-in reader's result is shown." };
    if (!res.ok) return { error: `AI service error (${res.status}). The built-in reader's result is shown.` };
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const out = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return { parsed: toParsed(JSON.parse(out.replace(/^```(?:json)?|```$/g, "").trim())) };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { error: aborted ? "The AI took too long. The built-in reader's result is shown." : "The AI reply could not be read. The built-in reader's result is shown." };
  } finally {
    clearTimeout(timer);
  }
}
