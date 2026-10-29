// Cities kept in Master data next to the parks (Delhi, Agra, Khajuraho...) and the
// hotels in them (Roseate House, Radisson Khajuraho). They are not safari stops:
// a night there is a city stay, typed with a name and a price per night.
//
// A "city" is a place in Parks with no safari rates and no own or partner lodge.
// A "city hotel" is a lodge or hotel of type City hotel, or one in a city.
import type { BuilderContext } from "./types";

type Ctx = Pick<BuilderContext, "properties" | "pricing">;
const norm = (s: string) => s.toLowerCase().replace(/\bnew delhi\b/, "delhi").replace(/[^a-z0-9]+/g, " ").trim();

type Places = { properties: { park_id: string | null; kind?: string }[]; pricing: { parks: { id: string; name: string }[]; safariRates: { park_id: string; active?: boolean }[] } };

// Towns and cities guests stay in before or after the safari.
const KNOWN_CITIES = new Set(
  "delhi new-delhi agra jaipur khajuraho orchha varanasi siliguri darjeeling gangtok bagdogra kalimpong mumbai kolkata bengaluru chennai hyderabad udaipur jodhpur jaisalmer lucknow goa kathmandu jabalpur nagpur bhopal raipur indore gwalior jhansi satna katni umaria chandrapur pune ahmedabad".split(" ").map((c) => c.replace("-", " "))
);

export function cityParkIds(ctx: Places): Set<string> {
  const rated = new Set(ctx.pricing.safariRates.filter((r) => r.active !== false).map((r) => r.park_id));
  return new Set(
    ctx.pricing.parks
      .filter((p) => !rated.has(p.id))
      // a known city, or a place with no own or partner lodge in it
      .filter((p) => KNOWN_CITIES.has(norm(p.name)) || !ctx.properties.some((l) => l.park_id === p.id && l.kind !== "city_hotel"))
      .map((p) => p.id)
  );
}

export const isCityHotel = (l: { kind?: string; park_id: string | null }, cityParks: Set<string>) => l.kind === "city_hotel" || (!!l.park_id && cityParks.has(l.park_id));

// The context with only safari parks and safari lodges: what the trip assistant plans stops from.
export function safariOnly<T extends Ctx>(ctx: T): T {
  const cities = cityParkIds(ctx);
  if (!cities.size && !ctx.properties.some((l) => l.kind === "city_hotel")) return ctx;
  return {
    ...ctx,
    properties: ctx.properties.filter((l) => !isCityHotel(l, cities)),
    pricing: { ...ctx.pricing, parks: ctx.pricing.parks.filter((p) => !cities.has(p.id)) },
  };
}

// The city hotels in Master data, with the city each one is in.
export function cityHotels(ctx: Ctx): { name: string; city: string }[] {
  const cities = cityParkIds(ctx);
  return ctx.properties
    .filter((l) => isCityHotel(l, cities))
    .map((l) => ({ name: l.name, city: l.city || ctx.pricing.parks.find((p) => p.id === l.park_id)?.name || "" }))
    .filter((h) => h.city);
}

export const sameCity = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.split(" ")[0] === y.split(" ")[0]);
};

// A city hotel from Master data named in a message ("Roseate House", "the roseate").
export function cityHotelNamed(msg: string, ctx: Ctx, city?: string): { name: string; city: string } | undefined {
  const low = ` ${norm(msg)} `;
  const generic = new Set(["hotel", "the", "house", "resort", "inn", "lodge", "palace", "grand", "new", "delhi", "jass"]);
  return cityHotels(ctx)
    .filter((h) => !city || sameCity(h.city, city))
    .find((h) => {
      const n = norm(h.name);
      if (low.includes(` ${n} `)) return true;
      // the distinctive first word is enough ("Roseate", "Radisson")
      const first = n.split(" ").find((w) => w.length >= 4 && !generic.has(w));
      return !!first && low.includes(` ${first} `);
    });
}

// Where a city stay sits in the trip, in words: "before the safari", "between Pench and
// Kaziranga" (a stay with `at` lodges before it), or "at the end".
export function stayWhere(
  c: { when: "before" | "after"; at?: number | null },
  stops: { park_id: string }[],
  parks: { id: string; name: string }[]
): string {
  if (c.when === "before") return "before the safari";
  const parkAt = (k: number) => parks.find((p) => p.id === stops[k]?.park_id)?.name.split(/[ -]/)[0] ?? "";
  if (c.at !== undefined && c.at !== null && c.at > 0 && c.at < stops.length) return `between ${parkAt(c.at - 1)} and ${parkAt(c.at)}`;
  return "at the end";
}

// One key per city stay ("before:Delhi", "after:Delhi@3" for a stay between parks), so two
// stays in the same city do not share the hotel question.
export const stayKey = (c: { when: string; city: string; at?: number | null }) => `${c.when}:${c.city}${c.at ? `@${c.at}` : ""}`;
