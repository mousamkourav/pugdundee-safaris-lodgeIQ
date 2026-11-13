// The Red Panda built-in reader (pure; tested in reader.test.ts): an enquiry in plain words ->
// the quote's fields. Its own small reader: a Red Panda enquiry never goes through the Safari
// reader. Used alone when the AI is off or fails, and to fill what the AI left empty.
//
// Reads: guests (adults, couple, solo, family of N), children's ages, nationality / country, an
// agent, the arrival date (or arrival - departure), nights ("5 nights", "5N6D", "6 days"), the
// airports (Bagdogra / Siliguri / IXB, Bhadrapur / BDP), rooms, a tour leader, nights at the hotel
// near Bagdogra (Mayfair) before or after, its room type, the guest's name, email and phone.
import type { AirportCode } from "./types";

export interface RpReading {
  name?: string;
  email?: string;
  phone?: string;
  adults?: number;
  child_ages?: number[];
  children?: number; // children written without ages
  nationality?: "indian" | "foreign";
  country?: string;
  booked_by?: "agent" | "direct";
  agent_name?: string;
  arrival?: string;
  dateless?: boolean; // "dates not fixed / not decided / TBD"
  nights?: number;
  arrive_airport?: AirportCode;
  depart_airport?: AirportCode;
  rooms?: number;
  tour_leader?: boolean;
  hotel_before?: { nights: number; room?: string };
  hotel_after?: { nights: number; room?: string };
  hotel_room?: string; // the room type alone (an answer to "which room?")
  // Delhi before / after Red Panda (the flight Delhi - Bagdogra), nights there (0 = same-day connection)
  delhi_before?: { nights: number; hotel?: string };
  delhi_after?: { nights: number; hotel?: string };
  delhi_hotel?: string; // the Delhi hotel alone (an answer to "which hotel?")
}

// the field a bare answer ("3", "indian", "20 nov") fills: the assistant's last question
export type RpPending = "arrival" | "adults" | "nationality" | "nights" | "ages" | "hotel_side" | "hotel_room" | "delhi_hotel" | null;

const NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, ek: 1, two: 2, couple: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, five: 5, paanch: 5, six: 6, seven: 7, saat: 7,
  eight: 8, aath: 8, nine: 9, ten: 10, das: 10, eleven: 11, twelve: 12,
};
const NUM_RE = "(\\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ek|do|teen|char|paanch|saat|aath|das)";
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()] ?? NaN);

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

// countries people write (foreign guests); "India" = Indian
const COUNTRIES: [RegExp, string][] = [
  [/\b(uk|u\.k\.|united kingdom|england|britain|british|scotland|wales)\b/i, "United Kingdom"],
  [/\b(usa|u\.s\.a?\.?|us citizens?|united states|america|american)\b/i, "United States"],
  [/\b(germany|german)\b/i, "Germany"],
  [/\b(france|french)\b/i, "France"],
  [/\b(australia|australian)\b/i, "Australia"],
  [/\b(canada|canadian)\b/i, "Canada"],
  [/\b(netherlands|holland|dutch)\b/i, "Netherlands"],
  [/\b(belgium|belgian)\b/i, "Belgium"],
  [/\b(switzerland|swiss)\b/i, "Switzerland"],
  [/\b(italy|italian)\b/i, "Italy"],
  [/\b(spain|spanish)\b/i, "Spain"],
  [/\b(sweden|swedish)\b/i, "Sweden"],
  [/\b(norway|norwegian)\b/i, "Norway"],
  [/\b(denmark|danish)\b/i, "Denmark"],
  [/\b(ireland|irish)\b/i, "Ireland"],
  [/\b(new zealand|kiwi)\b/i, "New Zealand"],
  [/\b(singapore|singaporean)\b/i, "Singapore"],
  [/\b(japan|japanese)\b/i, "Japan"],
  [/\b(israel|israeli)\b/i, "Israel"],
  [/\b(south africa)\b/i, "South Africa"],
  [/\b(austria|austrian)\b/i, "Austria"],
  [/\b(finland|finnish)\b/i, "Finland"],
  [/\b(nepal|nepali|nepalese)\b(?!\s*(?:side|border|visa))/i, "Nepal"],
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const t = Date.UTC(y, m - 1, d);
  const x = new Date(t);
  return x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
// a date without a year: the next one on or after today
function withYear(m: number, d: number, today: string, y?: number): string | null {
  if (y) return iso(y < 100 ? 2000 + y : y, m, d);
  const ty = Number(today.slice(0, 4));
  const a = iso(ty, m, d);
  return a && a >= today ? a : iso(ty + 1, m, d);
}

// every date in the text, in order of appearance
export function datesIn(text: string, today: string): { date: string; at: number; end: number }[] {
  const out: { date: string; at: number; end: number }[] = [];
  const t = text.toLowerCase();
  const push = (date: string | null, at: number, end: number) => {
    if (date && !out.some((o) => at < o.end && end > o.at)) out.push({ date, at, end });
  };
  for (const m of t.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) push(iso(Number(m[1]), Number(m[2]), Number(m[3])), m.index!, m.index! + m[0].length);
  for (const m of t.matchAll(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/g)) {
    if (!m[3] && !/\b(arriv|on|from|date|dates|reach)\b/.test(t.slice(Math.max(0, m.index! - 15), m.index!))) continue; // "5/6" alone is not a date
    push(withYear(Number(m[2]), Number(m[1]), today, m[3] ? Number(m[3]) : undefined), m.index!, m.index! + m[0].length);
  }
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_RE}\\b[,.]?\\s*(?:'|\u2019)?(\\d{4}|\\d{2}(?!\\s*(?:n|nights?|days?|pax|adults?)))?`, "g");
  for (const m of t.matchAll(dm)) push(withYear(MONTHS[m[2]], Number(m[1]), today, m[3] ? Number(m[3]) : undefined), m.index!, m.index! + m[0].length);
  const md = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, "g");
  for (const m of t.matchAll(md)) push(withYear(MONTHS[m[1]], Number(m[2]), today, m[3] ? Number(m[3]) : undefined), m.index!, m.index! + m[0].length);
  // "20-25 nov" / "20 to 25 nov": both days of the month
  const range = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|to|till|until)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b(?:\\s*(\\d{4}))?`, "g");
  for (const m of t.matchAll(range)) {
    const y = m[4] ? Number(m[4]) : undefined;
    push(withYear(MONTHS[m[3]], Number(m[1]), today, y), m.index!, m.index! + m[1].length);
  }
  return out.sort((a, b) => a.at - b.at);
}

// a room type's words as people write them: "Mountain View Room (twin beds, balcony)" -> "mountain view"
const roomKey = (name: string) => name.toLowerCase().replace(/\(.*$/, "").replace(/\brooms?\b/g, "").replace(/\s+/g, " ").trim();

// a hotel's own word, as people write it: "Roseate House" -> "roseate", "The Leela Palace" -> "leela"
const hotelWord = (name: string) => name.toLowerCase().split(/[^a-z]+/).find((w) => w.length >= 4 && !["hotel", "house", "palace", "resort", "delhi", "taj"].includes(w)) ?? name.toLowerCase();

const HOTEL_WORDS = "(?:mayfair(?:\\s+chumta)?|siliguri|bagdogra|hotel(?:\\s+near\\s+bagdogra)?)";

export function readEnquiry(text: string, today: string, opts: { pending?: RpPending; hotelRooms?: string[]; delhiHotels?: string[] } = {}): RpReading {
  const r: RpReading = {};
  let t = ` ${text.replace(/\s+/g, " ").trim()} `;
  const lower = () => t.toLowerCase();

  // ---- contact details (never sent to the AI; read here only)
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(t);
  if (email) r.email = email[0];
  const phone = /\+?\d[\d\s-]{8,}\d/.exec(t.replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, " "));
  if (phone && phone[0].replace(/\D/g, "").length >= 10) r.phone = phone[0].trim();
  const name =
    /\b(?:[Mm]r|[Mm]rs|[Mm]s|[Mm]iss|[Dd]r)\.?\s+((?:&\s*(?:[Mm]rs?|[Mm]s)\.?\s+)?[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/.exec(t) ?? /\bname\s*(?:is|:|-)\s*([A-Za-z][A-Za-z .'-]{1,58}?)(?=[,.;\n]|\s+(?:and|from|with)\b|$)/i.exec(t);
  if (name) r.name = name[0].replace(/^name\s*(?:is|:|-)\s*/i, "").trim();

  // ---- Delhi (before the flight to Bagdogra, or after the flight back): its nights are not the Outpost's
  {
    const lw = lower();
    const rp = lw.search(/\b(red\s*panda|outpost|singalila|bagdogra|ixb|siliguri|mayfair)\b/);
    const delhiHotel = (span: string) => (opts.delhiHotels ?? []).find((h) => span.includes(hotelWord(h)));
    const side = (at: number, span: string): "before" | "after" => {
      const around = lw.slice(Math.max(0, at - 30), at + span.length);
      if (/\b(back|return\w*|after|end|last|before (?:departure|flying home|the flight home)|fly(?:ing)? home|homebound)\b/.test(around)) return "after";
      if (/\b(arriv\w*|land\w*|first|start|via|before)\b/.test(around)) return "before";
      return rp >= 0 && at > rp ? "after" : "before";
    };
    const nightsRe = new RegExp(`\\b${NUM_RE}\\s*(?:n\\b|nights?|nts?|raat)\\s*(?:stay\\s+)?(?:in|at|@)?\\s*(?:the\\s+)?(?:new\\s+)?delhi\\b[^,.;\\n]*|\\b(?:new\\s+)?delhi\\s*(?:for\\s+)?${NUM_RE}\\s*(?:n\\b|nights?|nts?|raat)[^,.;\\n]*`, "gi");
    for (const m of [...t.matchAll(nightsRe)]) {
      const n = toNum(m[1] ?? m[2]);
      if (!Number.isFinite(n) || n < 1 || n > 5) continue;
      const span = m[0].toLowerCase();
      const hotel = delhiHotel(lw.slice(m.index!, m.index! + m[0].length + 40));
      r[side(m.index!, span) === "after" ? "delhi_after" : "delhi_before"] = { nights: n, ...(hotel ? { hotel } : {}) };
      t = t.slice(0, m.index!) + " ".repeat(m[0].length) + t.slice(m.index! + m[0].length);
    }
    // the flight alone: "arriving delhi", "via delhi", "fly back to delhi"
    const lw2 = lower();
    for (const m of lw2.matchAll(/\b(?:new\s+)?delhi\b/g)) {
      const k = side(m.index!, m[0]) === "after" ? "delhi_after" : "delhi_before";
      if (!r[k]) r[k] = { nights: 0 };
    }
  }

  // ---- the hotel near Bagdogra first (its nights are not the Outpost's)
  const hotelRe = new RegExp(`\\b${NUM_RE}\\s*(?:n\\b|nights?|nts?)\\s*(?:stay\\s+)?(?:at|in|@)?\\s*(?:the\\s+)?${HOTEL_WORDS}[^,.;\\n]*`, "gi");
  const hotelRe2 = new RegExp(`\\b${HOTEL_WORDS}\\s*(?:for\\s+)?${NUM_RE}\\s*(?:n\\b|nights?|nts?)[^,.;\\n]*`, "gi");
  for (const re of [hotelRe, hotelRe2]) {
    for (const m of [...t.matchAll(re)]) {
      const n = toNum(m[1]);
      if (!Number.isFinite(n) || n < 1 || n > 5) continue;
      const span = m[0].toLowerCase();
      const around = lower().slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 30);
      const after = /\b(after|end|last|before (?:the )?(?:departure|flight|leaving|fly(?:ing)?)|on (?:the )?way back|return)\b/.test(span) || /\b(after (?:the )?(?:outpost|red panda|trip|stay)|at the end|before (?:departure|flying|the flight))\b/.test(around);
      const room = (opts.hotelRooms ?? []).find((rn) => {
        const k = roomKey(rn);
        return k.length >= 4 && around.includes(k);
      });
      const v = { nights: n, ...(room ? { room } : {}) };
      if (after) r.hotel_after = v;
      else r.hotel_before = v;
      t = t.slice(0, m.index!) + " ".repeat(m[0].length) + t.slice(m.index! + m[0].length);
    }
  }

  // ---- guests
  const l = lower();
  const adults = new RegExp(`\\b${NUM_RE}\\s*(?:adults?|pax|guests?|people|persons?|travell?ers?|members?|ppl|log)\\b`, "i").exec(l);
  const family = new RegExp(`\\bfamily of\\s*${NUM_RE}\\b`, "i").exec(l);
  const groupOf = new RegExp(`\\bgroup of\\s*${NUM_RE}\\b`, "i").exec(l);
  if (adults) r.adults = toNum(adults[1]);
  else if (groupOf) r.adults = toNum(groupOf[1]);
  else if (/\b(couple|honeymoon(?:ers)?|husband and wife|(?:me |and |with )(?:my |his |her |their )?(?:wife|husband|partner|spouse))\b/.test(l)) r.adults = 2;
  else if (/\b(solo|alone|single traveller|single guest|one person|1 person)\b/.test(l)) r.adults = 1;

  // children: "2 kids aged 16 and 17", "son 17", "children (16, 18)", "teenager of 16"
  const ages: number[] = [];
  const kidRe = /\b(?:(\d{1,2}|one|two|three|four)\s+)?(?:kids?|child(?:ren)?|teen(?:ager)?s?|sons?|daughters?)\b\s*(?:\(|,)?\s*(?:aged?|ages?|of|age)?\s*((?:\d{1,2}\s*(?:,|and|&|\+)?\s*)+)?(?:\)|\s*(?:y|yrs?|years?)(?:\s*old)?)?/gi;
  let kidCount = 0;
  for (const m of l.matchAll(kidRe)) {
    if (m[1]) kidCount += toNum(m[1]);
    if (m[2]) ages.push(...(m[2].match(/\d{1,2}/g) ?? []).map(Number));
    else if (!m[1]) kidCount += 1;
  }
  for (const m of l.matchAll(/\b(\d{1,2})\s*(?:yrs?|years?)\s*old\b/g)) if (!ages.includes(Number(m[1]))) ages.push(Number(m[1]));
  if (ages.length) r.child_ages = ages;
  else if (kidCount > 0) r.children = kidCount;
  if (family && r.adults == null) r.adults = Math.max(1, toNum(family[1]) - (ages.length || kidCount));

  // ---- nationality, agent
  if (/\b(indians?|from india|indian nationals?|resident indians?|domestic guests?)\b/.test(l)) r.nationality = "indian";
  else {
    const c = COUNTRIES.find(([re]) => re.test(t));
    if (c) {
      r.nationality = "foreign";
      r.country = c[1];
    } else if (/\b(foreigners?|foreign nationals?|international guests?|overseas|nri)\b/.test(l)) r.nationality = "foreign";
  }
  if (/\b(agents?|b2b|travel agency|agency|tour operators?|dmc|our client|my client)\b/.test(l)) {
    r.booked_by = "agent";
    const an = /\b(?:from|via|through|by|agent|agency|operator)\s*[:-]?\s*([A-Z][\w&.'-]*(?:\s+[A-Z&][\w&.'-]*){0,3}\s+(?:Travels?|Tours?|Holidays?|Journeys?|Safaris?|Expeditions?|Ventures?|Trips?))\b/.exec(t);
    if (an) r.agent_name = an[1];
  } else if (/\b(direct (?:guest|booking|enquiry)|b2c)\b/.test(l)) r.booked_by = "direct";

  // ---- dates and nights
  const dates = datesIn(t, today);
  if (dates.length) r.arrival = dates[0].date;
  else if (/\b(?:dates?\s+(?:are\s+|is\s+)?(?:not\s+(?:yet\s+)?(?:fixed|decided|confirmed|final(?:i[sz]ed)?|known)|tbd|tba|open|flexible|undecided)|no\s+(?:fixed\s+)?dates?(?:\s+(?:yet|fixed))?|without\s+dates?|dateless|tarikh\s+(?:abhi\s+)?(?:fix\s+)?nahi)\b/i.test(l)) r.dateless = true;
  const nn = new RegExp(`\\b${NUM_RE}(?:\\s*(?:nights?|nts?|raat)\\b|(?<=\\d)n(?=\\b|\\d))`, "i").exec(l) ?? /\b(\d{1,2})n\s*\/?\s*\d{1,2}d\b/i.exec(l);
  const dd = new RegExp(`\\b${NUM_RE}(?:\\s*(?:days?|din)\\b|(?<=\\d)d\\b)`, "i").exec(l);
  if (nn) r.nights = toNum(nn[1]);
  else if (dd && toNum(dd[1]) > 1) r.nights = toNum(dd[1]) - 1;
  else if (dates.length >= 2 && dates[1].date > dates[0].date) {
    const d = Math.round((Date.parse(dates[1].date) - Date.parse(dates[0].date)) / 86_400_000);
    const hotel = (r.hotel_before?.nights ?? 0) + (r.hotel_after?.nights ?? 0);
    if (d - hotel >= 1 && d - hotel <= 30) r.nights = d - hotel;
  }

  // ---- airports: one named = both ways; two = in and out (or as the words say)
  const ap: { code: AirportCode; at: number }[] = [];
  for (const m of l.matchAll(/\b(bagdogra|ixb|siliguri|njp|new jalpaiguri)\b/g)) ap.push({ code: "IXB", at: m.index! });
  for (const m of l.matchAll(/\b(bhadrapur|bdp|chandragadhi|kathmandu)\b/g)) ap.push({ code: "BDP", at: m.index! });
  ap.sort((a, b) => a.at - b.at);
  if (ap.length) {
    const outWord = (a: { at: number }) => /\b(depart\w*|leav\w*|out|back|return\w*|drop|fly (?:out|back)|exit)\b/.test(l.slice(Math.max(0, a.at - 25), a.at));
    const outs = ap.filter(outWord);
    const ins = ap.filter((a) => !outWord(a));
    r.arrive_airport = (ins[0] ?? ap[0]).code;
    r.depart_airport = (outs[outs.length - 1] ?? (ins.length > 1 ? ins[ins.length - 1] : ap[ap.length - 1])).code;
  }

  // ---- rooms, tour leader
  const rooms = new RegExp(`\\b${NUM_RE}\\s*(?:rooms?|kamre|kamra)\\b`, "i").exec(l);
  if (rooms) r.rooms = toNum(rooms[1]);
  if (/\b(tour (?:leader|manager)|group leader|escort)\b/.test(l)) r.tour_leader = true;

  // ---- a bare answer to the assistant's question
  const bare = text.trim().toLowerCase();
  if (opts.pending && /^\d{1,2}$/.test(bare)) {
    const n = Number(bare);
    if (opts.pending === "adults" && r.adults == null) r.adults = n;
    if (opts.pending === "nights" && r.nights == null) r.nights = n;
    if (opts.pending === "ages" && !r.child_ages) r.child_ages = [n];
  }
  if (opts.pending === "ages" && !r.child_ages && /^[\d\s,&and]+$/.test(bare)) r.child_ages = (bare.match(/\d{1,2}/g) ?? []).map(Number);
  if (opts.pending === "nationality" && !r.nationality) {
    if (/^(foreign(?:er|ers)?|international|overseas)$/.test(bare)) r.nationality = "foreign";
  }
  if (opts.pending === "hotel_side") {
    if (/\bafter\b|\bend\b|\blast\b/.test(bare)) r.hotel_after = { nights: 0 }; // only the side (filled from the plan)
    else if (/\bbefore\b|\bfirst\b|\barrival\b|\bstart\b/.test(bare)) r.hotel_before = { nights: 0 };
  }
  if (opts.pending === "hotel_room") {
    const room = (opts.hotelRooms ?? []).find((rn) => {
      const k = roomKey(rn);
      return bare.includes(k) || (k.split(" ")[0].length >= 4 && bare.includes(k.split(" ")[0]));
    });
    if (room) r.hotel_room = room;
  }
  if (opts.pending === "delhi_hotel") {
    const h = (opts.delhiHotels ?? []).find((x) => bare.includes(hotelWord(x)));
    if (h) r.delhi_hotel = h;
  }
  // keep only sensible numbers
  if (r.adults != null && !(r.adults >= 1 && r.adults <= 20)) delete r.adults;
  if (r.nights != null && !(r.nights >= 1 && r.nights <= 30)) delete r.nights;
  if (r.rooms != null && !(r.rooms >= 1 && r.rooms <= 10)) delete r.rooms;
  return r;
}
