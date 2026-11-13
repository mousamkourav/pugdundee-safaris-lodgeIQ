// The Red Panda guest page and PDF text from the saved quote and the Master data text (pure;
// tested in content.test.ts): at a glance, day by day with dated days (with the year), the stay,
// includes / does not include, good to know, what to carry, payment terms.
import { fmtDay } from "@/lib/sales/format";
import { addDays } from "./pricing";
import type { RpPlan, RpPrice, RpSettings } from "./types";

export interface RpGuestDay {
  n: number;
  to?: number; // the last day of a block ("Day 3-5": n 3, to 5)
  date: string | null;
  dateText: string; // a block: "Sat, 13 Feb 2027 - Mon, 15 Feb 2027
  title: string;
  text: string;
  stay: string | null; // where they sleep that night
}
export interface RpGuestContent {
  title: string;
  tagline: string;
  intro: string;
  stayText: string;
  glance: { label: string; value: string }[];
  days: RpGuestDay[];
  inclusions: string[];
  exclusions: string[];
  goodToKnow: string[];
  whatToCarry: string[];
  paymentTerms: string;
  arrival: string | null;
  departure: string | null;
  datelessNote?: string; // dates not fixed: under the price (as on the Sales guest page)
  nights: number; // all nights of the trip
  guests: number;
  rooms: number;
}

// The days after the first full day at the Outpost, written once as one block ("Day 3-5"; owner,
// 10 Nov 2026: the same text on each day read as a repeat). Master data can change it (4th day text).
export const RP_LATER_DAYS = {
  title: "The search continues: sunrise, sunset and day hikes",
  text: "We follow the same routine as the trekkers continue their search. On one of the days we have the option to drive out for sunrise, as the mighty Kanchenjunga unfolds with the first light, while the trekking team continues the search. We also have the option to go for sunset and see the majestic peaks. Guests can also opt for one of the day hikes we offer through the scenic mountain vistas.",
};
// "Day 3" or "Day 3-5"
export const rpDayLabel = (d: Pick<RpGuestDay, "n" | "to">) => (d.to && d.to > d.n ? `Day ${d.n}-${d.to}` : `Day ${d.n}`);

const short = (name: string) => name.replace(/\s*\(.*$/, "").replace(/,.*$/, "").trim();

function fill(t: string, vars: Record<string, string | number>): string {
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function rpGuestContent(plan: RpPlan, price: RpPrice, s: RpSettings): RpGuestContent {
  const air = (c: string) => s.airports.find((a) => a.code === c);
  const inAir = air(plan.arrive_airport);
  const outAir = air(plan.depart_airport);
  const hotelLine = (key: "before" | "after") => price.lines.find((l) => l.key === `hotel_${key}`);
  const hotelName = (key: "before" | "after") => hotelLine(key)?.label.split(",")[0] ?? null;
  const nights = plan.nights;
  const before = hotelLine("before") ? plan.hotel_before.nights : 0;
  const after = hotelLine("after") ? plan.hotel_after.nights : 0;
  const vars: Record<string, string | number> = {
    airport: inAir ? short(inAir.name) : "the airport",
    hours: inAir?.hours ?? "",
    departure_airport: outAir ? short(outAir.name) : "the airport",
    nights,
    days: nights + 1,
    expedition_days: Math.max(0, nights - 1),
    deposit_pct: s.deposit_pct,
    balance_pct: 100 - s.deposit_pct,
    balance_days: s.balance_days_before,
  };
  const [arriveText, stayDay, departText] = [s.days[0], s.days[1], s.days[2]];
  const laterDays = s.days[3]?.title ? s.days[3] : RP_LATER_DAYS;
  const date = (i: number) => (price.arrival ? addDays(price.arrival, i) : null);
  const days: RpGuestDay[] = [];
  let dayNo = 1; // the next day's number (a block counts all its days)
  const push = (title: string, text: string, stay: string | null, span = 1) => {
    const d = date(dayNo - 1);
    const last = span > 1 ? date(dayNo - 1 + span - 1) : null;
    days.push({ n: dayNo, ...(span > 1 ? { to: dayNo + span - 1 } : {}), date: d, dateText: last && d ? `${fmtDay(d)} - ${fmtDay(last)}` : fmtDay(d), title, text, stay });
    dayNo += span;
  };
  // Delhi first: arrive in Delhi, nights there, then the flight to Bagdogra
  const delhiLine = (k: "delhi_before" | "delhi_after") => price.lines.find((l) => l.key === k);
  const dIn = plan.delhi_before.flight ? (delhiLine("delhi_before") ? plan.delhi_before.nights : 0) : 0;
  const dOut = plan.delhi_after.flight ? (delhiLine("delhi_after") ? plan.delhi_after.nights : 0) : 0;
  const dIn1 = delhiLine("delhi_before")?.label.split(",")[0] ?? null;
  const dOut1 = delhiLine("delhi_after")?.label.split(",")[0] ?? null;
  for (let i = 0; i < dIn; i++)
    push(
      i === 0 ? `Arrival in Delhi, ${dIn1}` : `Delhi, ${dIn1}`,
      i === 0 ? `Arrive in Delhi and transfer to ${dIn1}. The day at leisure; overnight in Delhi.` : "A day at leisure in Delhi.",
      dIn1
    );
  // the day they reach Bagdogra: the flight from Delhi first
  const flightIn = plan.delhi_before.flight ? (dIn > 0 ? `After breakfast, transfer to Delhi Airport for the morning flight to Bagdogra. ` : `On landing in Delhi, connect to the flight to Bagdogra. `) : "";

  const h1 = hotelName("before");
  for (let i = 0; i < before; i++)
    push(
      i === 0 ? `Arrival at ${vars.airport}, ${h1}` : `At leisure, ${h1}`,
      i === 0 ? `${flightIn}Arrive at ${inAir?.name ?? "the airport"} and transfer to ${h1} for the night.` : "A day at leisure.",
      h1
    );
  push(arriveText?.title ?? "Arrival and transfer to Red Panda Outpost", (before ? "" : flightIn) + fill(arriveText?.text ?? "", vars), "Red Panda Outpost");
  // Day 2 at the Outpost as it is; the days after it, one block ("Day 3-5")
  if (nights >= 2) push(stayDay?.title ?? "At Red Panda Outpost", fill(stayDay?.text ?? "", vars), "Red Panda Outpost");
  if (nights >= 3) push(laterDays.title, fill(laterDays.text, vars), "Red Panda Outpost", nights - 2);
  const h2 = hotelName("after");
  const toDelhi = plan.delhi_after.flight;
  const flyDelhi = (lead: string) =>
    `${lead}transfer to Bagdogra Airport for the flight to Delhi${dOut > 0 ? `; on arrival, transfer to ${dOut1}. Overnight in Delhi.` : ", and your onward flight from Delhi."}`;
  if (after > 0) {
    push(`Return to ${h2}`, `After an early breakfast, we say goodbye to the mountains and drive back to ${h2}, close to Bagdogra.`, h2);
    for (let i = 1; i < after; i++) push(`At leisure, ${h2}`, "A day at leisure.", h2);
    if (toDelhi) push(dOut > 0 ? "Fly to Delhi" : "Departure", flyDelhi("After breakfast, "), dOut > 0 ? dOut1 : null);
    else push("Departure", `Transfer to ${outAir?.name ?? "the airport"} for your onward flight.`, null);
  } else if (toDelhi) {
    push(dOut > 0 ? "Goodbye to the mountains, fly to Delhi" : departText?.title ?? "Departure", `After an early breakfast, we say goodbye to the mountains and drive to Bagdogra Airport (about 5 hours, crossing back into India) for the afternoon flight to Delhi${dOut > 0 ? `; on arrival, transfer to ${dOut1}. Overnight in Delhi.` : ", and your onward flight from Delhi."}`, dOut > 0 ? dOut1 : null);
  } else push(departText?.title ?? "Departure", fill(departText?.text ?? "", vars), null);
  if (toDelhi && dOut > 0) {
    for (let i = 1; i < dOut; i++) push(`Delhi, ${dOut1}`, "A day at leisure in Delhi.", dOut1);
    push("Departure", `Transfer to Delhi Airport for your onward flight.`, null);
  }

  // the Final draft's changes for this quote (day number -> text)
  for (const d of days) {
    const own = plan.text?.days?.[String(d.n)];
    if (own) d.text = own;
  }
  const totalNights = dIn + before + nights + after + dOut;
  const guestsText = `${price.guests} guest${price.guests === 1 ? "" : "s"}`;
  const glance = [
    { label: "Dates", value: price.arrival && price.departure ? `${fmtDay(price.arrival)} to ${fmtDay(price.departure)}` : "To be confirmed" },
    { label: "Duration", value: `${totalNights} nights / ${totalNights + 1} days` },
    { label: "Stay", value: [dIn1 && dIn ? `${dIn1}, Delhi, ${dIn} night${dIn === 1 ? "" : "s"}` : "", h1 ? `${h1}, ${before} night${before === 1 ? "" : "s"}` : "", `Red Panda Outpost, ${nights} nights`, h2 ? `${h2}, ${after} night${after === 1 ? "" : "s"}` : "", dOut1 && dOut ? `${dOut1}, Delhi, ${dOut} night${dOut === 1 ? "" : "s"}` : ""].filter(Boolean).join(" - ") },
    { label: "Guests", value: `${guestsText}, ${price.rooms} room${price.rooms === 1 ? "" : "s"} (twin beds)` },
    { label: "Arrival", value: plan.delhi_before.flight ? `Delhi, then the flight to ${inAir?.name ?? "Bagdogra"}` : inAir?.name ?? "" },
    { label: "Departure", value: plan.delhi_after.flight ? `${outAir?.name ?? "Bagdogra"}, flight to Delhi${dOut ? "" : " and your onward flight"}` : outAir?.name ?? "" },
    { label: "Drive to the Outpost", value: inAir ? `About ${inAir.hours} hours${plan.arrive_airport === "IXB" ? ", plus the border crossing" : ""}` : "" },
  ].filter((g) => g.value);

  // includes: the pick-up line names both airports when they differ
  const inclusions = s.inclusions.map((t) =>
    fill(t, { ...vars, airport: plan.arrive_airport === plan.depart_airport ? String(vars.airport) : `${vars.airport} (arrival) and ${vars.departure_airport} (departure)` })
  );
  const hotelInc: string[] = [];
  for (const k of ["before", "after"] as const) {
    const l = hotelLine(k);
    if (l) hotelInc.push(`${l.label}${price.lines.some((x) => x.key === `hotel_${k}_transfer`) ? ", with the Bagdogra Airport transfer" : ""}`);
  }
  for (const k of ["delhi_before", "delhi_after"] as const) {
    const l = delhiLine(k);
    if (l) hotelInc.unshift(`${l.label}, with the Delhi Airport transfers`);
  }
  for (const l of price.lines.filter((x) => x.group === "flight")) hotelInc.push(`${l.label.replace(/, \d{1,2} \w{3} \d{4}$/, "")} (economy)`);
  return {
    title: s.title,
    tagline: s.tagline,
    intro: plan.text?.intro || s.intro,
    stayText: s.stay_text,
    glance,
    days,
    inclusions: [...inclusions, ...hotelInc, ...price.lines.filter((l) => l.group === "extra").map((l) => l.label)],
    exclusions: s.exclusions,
    goodToKnow: [...(plan.text?.notes ?? []), ...s.good_to_know],
    whatToCarry: s.what_to_carry,
    paymentTerms: fill(s.payment_terms, vars),
    arrival: price.arrival,
    departure: price.departure,
    ...(price.dateless
      ? { datelessNote: `As the travel dates are not fixed yet, the price is worked out on the ${price.season ?? "current"} season tariff. Once the dates are confirmed, prices may vary slightly.` }
      : {}),
    nights: totalNights,
    guests: price.guests,
    rooms: price.rooms,
  };
}
