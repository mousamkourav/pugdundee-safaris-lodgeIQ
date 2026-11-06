// The Red Panda AI reading (pure parts; the call is in app/(dashboard)/red-panda/ai-actions.ts):
// the prompt, the evidence rule (every value must come with a quote that is in the message and
// states that value; otherwise it is dropped, never guessed), the merge with the built-in reader
// (AI first, the reader fills only what the AI left empty), and the text sent out (no names,
// emails or phone numbers). Tested in reader.test.ts.
import type { RpReading } from "./reader";

// ---------------- text sent to the AI ----------------

export function scrubRp(text: string, names: string[] = []): string {
  let t = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]");
  const dates: string[] = [];
  t = t.replace(/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/g, (d) => `\u0000${dates.push(d) - 1}\u0000`);
  for (const n of names.flatMap((x) => [x, ...x.split(/[^A-Za-z'-]+/)]).map((x) => x.trim()).filter((x) => x.length >= 3 && !/^(mr|mrs|ms|miss|dr|and|family)$/i.test(x)).sort((a, b) => b.length - a.length)) {
    t = t.replace(new RegExp(`(?<![A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`, "gi"), "[guest]");
  }
  return t
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[number]")
    .replace(/\b(?:mr|mrs|ms|miss|dr)\.?\s+(?:&\s*(?:mrs?|ms)\.?\s+)?[A-Za-z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?/gi, "[guest]")
    .replace(/\bname\s*(?:is|:|-)\s*[^,.;\n]{2,60}/gi, "name: [guest]")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => dates[Number(i)] ?? "")
    .slice(0, 3000);
}

// ---------------- the prompt ----------------

export function rpPrompt(message: string, today: string, hotelRooms: string[], delhiHotels: string[] = []): string {
  return [
    "You read a travel enquiry for Red Panda Outpost (a homestay near Singalila National Park, Nepal; guests fly into",
    "Bagdogra (IXB, Siliguri, India) or Bhadrapur (BDP, Nepal)). Today is " + today + ".",
    "Return ONLY JSON. For every field you fill give {\"value\": ..., \"quote\": \"the exact words of the message that say it\"}.",
    "Leave a field out when the message does not say it. Never guess, never fill from common sense.",
    "Fields:",
    "  adults: number of adults (a couple = 2).",
    "  child_ages: array of the children's ages, only ages written in the message.",
    "  children: number of children when no ages are written.",
    "  nationality: \"indian\" or \"foreign\".",
    "  country: the guests' country as written (not India).",
    "  booked_by: \"agent\" when an agent, agency, tour operator or DMC sends it for a client, else \"direct\" only if the message says so.",
    "  agent_name: the agency's name.",
    "  arrival: the day they land, as YYYY-MM-DD (no year written = the next such date on or after today).",
    "  nights: nights at Red Panda Outpost (not the hotel near Bagdogra). \"6 days\" = 5 nights.",
    "  arrive_airport, depart_airport: \"IXB\" (Bagdogra, Siliguri) or \"BDP\" (Bhadrapur).",
    "  rooms: number of rooms.",
    "  tour_leader: true when a tour leader / tour manager travels with them.",
    "  hotel_before, hotel_after: {\"nights\": n, \"room\": one of [" + hotelRooms.map((r) => JSON.stringify(r)).join(", ") + "] if written} for nights at a hotel near Bagdogra / Siliguri (Mayfair) before or after the Outpost.",
    "  delhi_before: {\"nights\": n, \"hotel\": one of [" + delhiHotels.map((r) => JSON.stringify(r)).join(", ") + "] if written} when they come through Delhi first (land in Delhi, then fly to Bagdogra); nights 0 = same-day connection.",
    "  delhi_after: the same for Delhi at the end (fly back from Bagdogra to Delhi).",
    "Names, emails and phone numbers have been removed; do not return them.",
    "",
    "Message:",
    message,
  ].join("\n");
}

// ---------------- the evidence rule ----------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// the quote is in the message: case and punctuation do not matter, small typos in words of 5+
// letters, numbers exactly
export function quoteIn(quote: unknown, message: string): boolean {
  if (typeof quote !== "string") return false;
  const q = norm(quote).split(" ").filter(Boolean);
  const m = norm(message).split(" ").filter(Boolean);
  if (!q.length || q.join("").length < 2) return false;
  for (let i = 0; i + q.length <= m.length; i++) {
    if (q.every((w, k) => w === m[i + k] || (!/\d/.test(w) && w.length >= 5 && lev(w, m[i + k]) <= 1))) return true;
  }
  return false;
}
const WORDS: Record<number, string[]> = { 1: ["one", "a", "an", "single", "solo", "alone"], 2: ["two", "couple", "both", "pair"], 3: ["three"], 4: ["four"], 5: ["five"], 6: ["six"], 7: ["seven"], 8: ["eight"], 9: ["nine"], 10: ["ten"], 11: ["eleven"], 12: ["twelve"] };
export function statesNumber(quote: string, n: number): boolean {
  const ws = norm(quote).replace(/(\d+)([a-z]+)/g, "$1 $2").split(" ");
  return ws.includes(String(n)) || (WORDS[n] ?? []).some((w) => ws.includes(w));
}
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface RpDropped {
  field: string;
  reason: string;
}

// The AI's answer -> a reading with only what the message shows.
export function checkRpEvidence(raw: unknown, message: string, hotelRooms: string[], delhiHotels: string[] = []): { reading: RpReading; dropped: RpDropped[] } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, { value?: unknown; quote?: unknown } | undefined>;
  const r: RpReading = {};
  const dropped: RpDropped[] = [];
  const take = (field: string, check: (v: unknown, q: string) => boolean, set: (v: unknown) => void) => {
    const x = a[field];
    if (!x || x.value === undefined || x.value === null) return;
    if (!quoteIn(x.quote, message)) return void dropped.push({ field, reason: "quote not in the message" });
    if (!check(x.value, String(x.quote))) return void dropped.push({ field, reason: "the quote does not say that" });
    set(x.value);
  };
  const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  const q = (s: string) => norm(s);

  take("adults", (v, s) => int(v, 1, 20) && statesNumber(s, v as number), (v) => (r.adults = v as number));
  take("child_ages", (v, s) => Array.isArray(v) && v.length > 0 && v.every((n) => int(n, 0, 25) && statesNumber(s, n as number)), (v) => (r.child_ages = v as number[]));
  take("children", (v, s) => int(v, 1, 10) && statesNumber(s, v as number), (v) => (r.children = v as number));
  take("nationality", (v, s) => (v === "indian" && /\bindia/.test(q(s))) || (v === "foreign" && q(s).length > 1 && !/\bindia/.test(q(s))), (v) => (r.nationality = v as "indian" | "foreign"));
  take("country", (v, s) => typeof v === "string" && v.length <= 60 && !/india/i.test(v) && quoteIn(v, s), (v) => (r.country = v as string));
  take("booked_by", (v, s) => (v === "agent" && /\b(agent|agents|agency|b2b|operator|dmc|client)\b/.test(q(s))) || (v === "direct" && /\b(direct|b2c)\b/.test(q(s))), (v) => (r.booked_by = v as "agent" | "direct"));
  take("agent_name", (v, s) => typeof v === "string" && v.length <= 120 && quoteIn(v, s), (v) => (r.agent_name = v as string));
  take(
    "arrival",
    (v, s) => {
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      const [, m, d] = v.split("-").map(Number);
      const qs = q(s);
      const hasDay = statesNumber(s, d) || new RegExp(`\\b0?${d}(st|nd|rd|th)?\\b`).test(qs);
      const hasMonth = qs.includes(MONTH_NAMES[m - 1]) || new RegExp(`\\b0?${m}\\b`).test(qs.replace(new RegExp(`\\b0?${d}(st|nd|rd|th)?\\b`), " "));
      return hasDay && hasMonth;
    },
    (v) => (r.arrival = v as string)
  );
  take("nights", (v, s) => int(v, 1, 30) && (statesNumber(s, v as number) || statesNumber(s, (v as number) + 1)), (v) => (r.nights = v as number));
  const apOk = (v: unknown, s: string) => (v === "IXB" && /\b(bagdogra|ixb|siliguri|njp|jalpaiguri)\b/.test(q(s))) || (v === "BDP" && /\b(bhadrapur|bdp|chandragadhi)\b/.test(q(s)));
  take("arrive_airport", apOk, (v) => (r.arrive_airport = v as "IXB" | "BDP"));
  take("depart_airport", apOk, (v) => (r.depart_airport = v as "IXB" | "BDP"));
  take("rooms", (v, s) => int(v, 1, 10) && statesNumber(s, v as number) && /room/.test(q(s)), (v) => (r.rooms = v as number));
  take("tour_leader", (v, s) => v === true && /\b(leader|manager|escort)\b/.test(q(s)), () => (r.tour_leader = true));
  for (const k of ["hotel_before", "hotel_after"] as const) {
    take(
      k,
      (v, s) => {
        const h = (v && typeof v === "object" ? v : {}) as { nights?: unknown; room?: unknown };
        return int(h.nights, 1, 5) && statesNumber(s, h.nights as number) && /\b(mayfair|siliguri|bagdogra|hotel)\b/.test(q(s)) && (h.room == null || hotelRooms.includes(String(h.room)));
      },
      (v) => {
        const h = v as { nights: number; room?: string };
        r[k] = { nights: h.nights, ...(h.room ? { room: h.room } : {}) };
      }
    );
  }
  for (const k of ["delhi_before", "delhi_after"] as const) {
    take(
      k,
      (v, s) => {
        const h = (v && typeof v === "object" ? v : {}) as { nights?: unknown; hotel?: unknown };
        return int(h.nights, 0, 5) && /\bdelhi\b/.test(q(s)) && ((h.nights as number) === 0 || statesNumber(s, h.nights as number)) && (h.hotel == null || delhiHotels.includes(String(h.hotel)));
      },
      (v) => {
        const h = v as { nights: number; hotel?: string };
        r[k] = { nights: h.nights, ...(h.hotel ? { hotel: h.hotel } : {}) };
      }
    );
  }
  return { reading: r, dropped };
}

// AI first; the built-in reader fills only what the AI left empty. Contact details always come
// from the reader (they never go to the AI).
export function mergeReadings(ai: RpReading, reader: RpReading): { reading: RpReading; added: string[] } {
  const out: RpReading = { ...ai };
  const added: string[] = [];
  for (const [k, v] of Object.entries(reader) as [keyof RpReading, unknown][]) {
    if (v === undefined) continue;
    if (out[k] === undefined) {
      (out as Record<string, unknown>)[k] = v;
      if (!["name", "email", "phone"].includes(k)) added.push(k.replace(/_/g, " "));
    }
  }
  return { reading: out, added };
}
