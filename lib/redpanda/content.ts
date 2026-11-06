// The Red Panda guest page and PDF text from the saved quote and the Master data text (pure;
// tested in content.test.ts): at a glance, day by day with dated days (with the year), the stay,
// includes / does not include, good to know, what to carry, payment terms.
import { fmtDay } from "@/lib/sales/format";
import { addDays } from "./pricing";
import type { RpPlan, RpPrice, RpSettings } from "./types";

export interface RpGuestDay {
  n: number;
  date: string | null;
  dateText: string;
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
  nights: number; // all nights of the trip
  guests: number;
  rooms: number;
}

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
  const date = (i: number) => (price.arrival ? addDays(price.arrival, i) : null);
  const days: RpGuestDay[] = [];
  const push = (title: string, text: string, stay: string | null) => {
    const d = date(days.length);
    days.push({ n: days.length + 1, date: d, dateText: fmtDay(d), title, text, stay });
  };
  const h1 = hotelName("before");
  for (let i = 0; i < before; i++)
    push(
      i === 0 ? `Arrival at ${vars.airport}, ${h1}` : `At leisure, ${h1}`,
      i === 0 ? `Arrive at ${inAir?.name ?? "the airport"} and transfer to ${h1} for the night.` : "A day at leisure.",
      h1
    );
  push(arriveText?.title ?? "Arrival and transfer to Red Panda Outpost", fill(arriveText?.text ?? "", vars), "Red Panda Outpost");
  for (let i = 1; i < nights; i++) push(stayDay?.title ?? "At Red Panda Outpost", fill(stayDay?.text ?? "", vars), "Red Panda Outpost");
  const h2 = hotelName("after");
  if (after > 0) {
    push(`Return to ${h2}`, `After an early breakfast, we say goodbye to the mountains and drive back to ${h2}, close to Bagdogra.`, h2);
    for (let i = 1; i < after; i++) push(`At leisure, ${h2}`, "A day at leisure.", h2);
    push("Departure", `Transfer to ${outAir?.name ?? "the airport"} for your onward flight.`, null);
  } else push(departText?.title ?? "Departure", fill(departText?.text ?? "", vars), null);

  const totalNights = before + nights + after;
  const guestsText = `${price.guests} guest${price.guests === 1 ? "" : "s"}`;
  const glance = [
    { label: "Dates", value: price.arrival && price.departure ? `${fmtDay(price.arrival)} to ${fmtDay(price.departure)}` : "To be confirmed" },
    { label: "Duration", value: `${totalNights} nights / ${totalNights + 1} days` },
    { label: "Stay", value: [h1 ? `${h1}, ${before} night${before === 1 ? "" : "s"}` : "", `Red Panda Outpost, ${nights} nights`, h2 ? `${h2}, ${after} night${after === 1 ? "" : "s"}` : ""].filter(Boolean).join(" - ") },
    { label: "Guests", value: `${guestsText}, ${price.rooms} room${price.rooms === 1 ? "" : "s"} (twin beds)` },
    { label: "Arrival", value: inAir?.name ?? "" },
    { label: "Departure", value: outAir?.name ?? "" },
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
  return {
    title: s.title,
    tagline: s.tagline,
    intro: s.intro,
    stayText: s.stay_text,
    glance,
    days,
    inclusions: [...inclusions, ...hotelInc, ...price.lines.filter((l) => l.group === "extra").map((l) => l.label)],
    exclusions: s.exclusions,
    goodToKnow: s.good_to_know,
    whatToCarry: s.what_to_carry,
    paymentTerms: fill(s.payment_terms, vars),
    arrival: price.arrival,
    departure: price.departure,
    nights: totalNights,
    guests: price.guests,
    rooms: price.rooms,
  };
}
