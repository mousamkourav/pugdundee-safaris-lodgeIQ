import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { paxLines } from "@/lib/sales/pricing/pax";
import { loadClientView } from "@/lib/sales/client-view";
import { DownloadPdfButton } from "@/components/sales/download-pdf";
import { ShareButtons } from "@/components/sales/share-buttons";
import { PhotoCarousel } from "@/components/sales/photo-carousel";
import { Icon } from "@/components/icons";
import { shortPark } from "@/lib/sales/plan/draft";
import { routeOf, segments } from "@/lib/sales/plan/planner";
import { sameCity } from "@/lib/sales/plan/cities";
import { fmtDay } from "@/lib/sales/format";

// Guest-facing itinerary. Public: opened from a share link without signing in.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const view = await loadClientView((await params).token);
  return {
    title: view ? `${view.routeLine || view.title} safari - ${view.guestName} - Pugdundee Safaris` : "Your safari itinerary - Pugdundee Safaris",
    robots: { index: false, follow: false },
  };
}

// Slideshows show as photo grids in the PDF and in print. While the PDF is being
// made, the page is laid out at a fixed A4-like width with comfortable type, and
// the cover fills the first page exactly.
const PDF_CSS = `.pdf-only{display:none}
html[data-pdf] .pdf-hide{display:none!important}
html[data-pdf] .pdf-only{display:grid!important}
html[data-pdf] #itinerary{width:820px!important;max-width:none!important;border-radius:0!important;font-size:15px}
html[data-pdf] [data-pdf-block="cover"]{min-height:0!important;height:auto!important;aspect-ratio:210/297}
@media print{.pdf-hide{display:none!important}.pdf-only{display:grid!important}}
details.park>summary::-webkit-details-marker{display:none}
details.park[open] .plus{transform:rotate(45deg)}`;

// "Pugdundee Safaris - 15 Mar 2027 - Barney Smith.pdf" (the date the trip starts)
const fileNameFor = (guest: string, start: string | null) =>
  [
    "Pugdundee Safaris",
    start ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(start + "T00:00:00Z")) : "",
    guest.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Itinerary",
  ]
    .filter(Boolean)
    .join(" - ") + ".pdf";

const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const long = (d: string | null) => (d ? LONG.format(new Date(d + "T00:00:00Z")) : "");

function money(n: number, currency: string) {
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "INR" ? 0 : 2,
  }).format(n);
}

// Small line icons for the guest page (kept here so the page stands alone).
const PATHS: Record<string, string> = {
  plane: "M2 16l20-6-20-6 3 6-3 6zm3-6h8",
  jeep: "M3 15h18v-3l-2-4H8L6 12H3v3zm3 0a2 2 0 1 0 4 0m4 0a2 2 0 1 0 4 0",
  leaf: "M5 19c8 0 14-6 14-14C11 5 5 11 5 19zm0 0l7-7",
  bed: "M3 18V8m0 6h18v4M3 11h7a3 3 0 0 1 3 3M14 11h4a3 3 0 0 1 3 3",
  sun: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  star: "M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6L12 16.4 6.6 19.3l1.3-6L3.3 9.2l6.1-.6L12 3z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
};
function Line({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

// An email or phone number in one form, to spot the same contact written twice
// ("Enquiry@..." and "enquiry@...", "+91 98102 53436" and "9810253436").
const contactKey = (c: string) => (/@/.test(c) ? c.trim().toLowerCase() : c.replace(/\D/g, "").slice(-10));

// Contacts one per line, but phone numbers next to each other share a line:
// "+91-11-40146400, +91-11-40132103".
function contactLines(contacts: string[]): string[][] {
  const out: string[][] = [];
  for (const c of contacts) {
    const last = out[out.length - 1];
    if (!/@/.test(c) && last && !/@/.test(last[0])) last.push(c);
    else out.push([c]);
  }
  return out;
}

// Pugdundee Safaris on the web (footer icons).
const SOCIAL = [
  { label: "Pugdundee Safaris website", href: "https://www.pugdundeesafaris.com/", path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6C8.9 5.5 8.4 6.7 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.2 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.8-5.6a16.5 16.5 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4z" },
  { label: "Facebook", href: "https://www.facebook.com/Pugdundeesafari/", path: "M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v9h4v-9h3l.5-4h-3.5V8.8c0-.5.3-.8.5-.8z" },
  { label: "Instagram", href: "https://www.instagram.com/pugdundeesafaris/", path: "M12 7.3a4.7 4.7 0 1 0 0 9.4 4.7 4.7 0 0 0 0-9.4zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0zM16.5 2h-9A5.5 5.5 0 0 0 2 7.5v9A5.5 5.5 0 0 0 7.5 22h9a5.5 5.5 0 0 0 5.5-5.5v-9A5.5 5.5 0 0 0 16.5 2zm3.7 14.5a3.7 3.7 0 0 1-3.7 3.7h-9a3.7 3.7 0 0 1-3.7-3.7v-9a3.7 3.7 0 0 1 3.7-3.7h9a3.7 3.7 0 0 1 3.7 3.7v9z" },
  { label: "YouTube", href: "https://www.youtube.com/user/Pugdundeesafaris", path: "M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3L10 15z" },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/pugdundee-safaris", path: "M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.5h4V21H3V9.5zm6.5 0h3.8v1.6h.1c.5-1 1.8-2 3.8-2 4 0 4.8 2.6 4.8 6V21h-4v-5.2c0-1.2 0-2.8-1.7-2.8s-2 1.3-2 2.7V21h-4V9.5z" },
];

export default async function ClientItineraryPage({ params }: { params: Promise<{ token: string }> }) {
  const view = await loadClientView((await params).token);
  if (!view) notFound();
  const { plan } = view;

  // The first day at each lodge shows the lodge as a feature.
  const firstDayAt = new Map<string, number>();
  plan.days.forEach((d, i) => {
    if (d.property_id && !firstDayAt.has(d.property_id)) firstDayAt.set(d.property_id, i);
  });

  // At a glance: the route, with nights, and the key numbers.
  // the whole trip in order: Delhi, the lodges, Khajuraho, Delhi, and any days added
  const flights = plan.flights ?? [];
  const segs = segments(plan);
  const route: { place: string; detail: string; nights: number; flightIn?: boolean }[] = segs.map((seg, k) => {
    const prev = segs[k - 1];
    if (seg.kind === "city") {
      const c = seg.stay;
      return {
        place: c.city || "Free day",
        detail: c.hotel || (c.blank ? "Hotel to be confirmed" : "City stay"),
        nights: c.nights,
        flightIn: !!c.city && flights.some((f) => sameCity(f.to, c.city)),
      };
    }
    const room = view.stays[seg.index]?.room;
    return {
      place: shortPark(view.parkNames[seg.stop.park_id] ?? ""),
      detail: [view.lodgeNames[seg.stop.property_id] ?? "", room].filter(Boolean).join(" \u00b7 "),
      nights: seg.stop.nights,
      flightIn: seg.index === 0 && prev?.kind === "city" && !!prev.stay.city && flights.some((f) => sameCity(f.from, prev.stay.city)),
    };
  });
  const safaris = plan.days.reduce((t, d) => t + d.safaris.length, 0);
  const lodgeCount = new Set(plan.stops.map((s) => s.property_id)).size;
  // At a glance: 17 D / 16 N, the safaris, and the places in travel order
  // (Delhi - Jabalpur - Kanha - Bandhavgarh - Khajuraho - Delhi).
  const dayCount = plan.days.length || view.nights + 1;
  const cityOf = (place: string | undefined) => (place ?? "").replace(/\s*(international\s+)?(airport|railway station|station|junction)\b.*$/i, "").replace(/\s*\(.*\)\s*$/, "").trim();
  const path: string[] = [];
  const add = (x: string | undefined) => {
    const v = (x ?? "").trim();
    if (v && path[path.length - 1]?.toLowerCase() !== v.toLowerCase()) path.push(v);
  };
  const firstDay = plan.days.find((d) => d.kind !== "city");
  segs.forEach((seg, k) => {
    const prev = segs[k - 1];
    if (seg.kind === "city") {
      const inFlight = prev?.kind === "lodge" ? flights.find((f) => sameCity(f.to, seg.stay.city) && !segs.some((x) => x.kind === "city" && sameCity(x.stay.city, f.from))) : undefined;
      if (inFlight) add(inFlight.from);
      add(seg.stay.city || undefined);
      return;
    }
    if (k === 0 || prev?.kind === "city") {
      // reached by air (Delhi to Jabalpur) or from the arrival airport: that town first
      const flown = prev?.kind === "city" ? flights.find((f) => sameCity(f.from, prev.stay.city)) : undefined;
      if (flown) add(flown.to);
      else if (k === 0 && firstDay?.transfer) add(cityOf(view.placeNames[firstDay.transfer.from_location_id]));
    }
    add(shortPark(view.parkNames[seg.stop.park_id] ?? ""));
  });
  if (segs[segs.length - 1]?.kind === "lodge") {
    const lastDay = plan.days[plan.days.length - 1];
    if (lastDay?.transfer) add(cityOf(view.placeNames[lastDay.transfer.to_location_id]));
  }
  const facts = [
    { n: `${dayCount}D / ${Math.max(0, dayCount - 1)}N`, label: "days / nights", wide: false },
    { n: String(safaris), label: safaris === 1 ? "safari" : "safaris", wide: false },
    ...(path.length > 1 ? [{ n: path.join(" \u2013 "), label: "your route", wide: true }] : [{ n: String(lodgeCount), label: lodgeCount === 1 ? "lodge" : "lodges", wide: false }]),
  ];

  // The footer's contacts, each once: a phone number or email already shown for the consultant
  // (or the teammate) is not repeated under Emergency contact.
  const dedupedFooter = (() => {
    const shown = new Set([view.consultant.email, view.consultant.phone].filter((x): x is string => !!x).map(contactKey));
    const emergency = !view.domestic && view.emergency ? view.emergency : null;
    const eEmail = emergency?.email && !shown.has(contactKey(emergency.email)) ? emergency.email : null;
    const ePhone = emergency?.phone && !shown.has(contactKey(emergency.phone)) ? emergency.phone : null;
    if (emergency) [emergency.email, emergency.phone].filter((x): x is string => !!x).forEach((x) => shown.add(contactKey(x)));
    const direct = view.directContacts.filter((c) => {
      const k = contactKey(c);
      if (!k || shown.has(k)) return false;
      shown.add(k);
      return true;
    });
    return { emergency, eEmail, ePhone, direct };
  })();

  return (
    <div className="min-h-screen bg-sand-100 text-[17px] leading-relaxed text-sand-700 sm:py-8 sm:text-base print:bg-white print:py-0">
      <style>{PDF_CSS}</style>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-0 sm:pt-0 print:hidden">
        <ShareButtons title={`${view.routeLine || view.title} safari - Pugdundee Safaris`} text={`Safari itinerary for ${view.guestName} from ${view.company.name}`} />
        <DownloadPdfButton fileName={fileNameFor(view.guestName, view.dateless ? null : view.arrival)} />
      </div>

      <article id="itinerary" className="mx-auto max-w-4xl overflow-hidden bg-white shadow-card sm:rounded-2xl print:max-w-none print:shadow-none">
        {/* ---------------- cover ---------------- */}
        <header data-pdf-block="cover" className="relative flex min-h-[88vh] flex-col justify-between bg-[var(--color-olive-900,#2B3318)] text-white sm:min-h-[640px] print:min-h-[960px]">
          {view.heroUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- public storage URL
            <img src={view.heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/10 to-black/80" />
          <div className="relative flex items-center justify-between px-6 pt-6 sm:px-12 sm:pt-10">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/90">{view.company.name}</p>
            <p className="hidden text-xs uppercase tracking-[0.2em] text-white/70 sm:block">Wildlife lodges &amp; experiences</p>
          </div>
          <div className="relative px-6 pb-10 sm:px-12 sm:pb-14">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--color-gold-200,#EBD9A0)]">A private safari prepared for</p>
            <p className="mt-1 font-display text-2xl font-semibold leading-tight !text-white sm:text-3xl">{view.guestName}</p>
            <h1 className="mt-5 max-w-3xl font-display text-[2.1rem] font-semibold leading-[1.1] !text-white sm:text-5xl">{view.title}</h1>
            {view.routeLine && <p className="mt-4 font-display text-xl italic text-[var(--color-gold-200,#EBD9A0)] sm:text-xl">{view.routeLine}</p>}
            <div className="mt-6 h-px w-24 bg-[var(--color-gold-300,#DDC277)]" />
            <p className="mt-5 text-base text-white/90 sm:text-lg">
              {view.dateless ? "Travel dates to be confirmed" : <>{long(view.arrival)} &ndash; {long(view.departure)}</>}
              <span className="mx-2 text-white/50">|</span>
              {plan.days.length || view.nights + 1} days
              <span className="mx-2 text-white/50">|</span>
              {view.guests} guest{view.guests === 1 ? "" : "s"}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-white/60">
              Quote {view.queryNo} &middot; prepared {long(view.quotedOn)}
            </p>
          </div>
        </header>

        <div className="space-y-14 px-5 py-10 sm:px-12 sm:py-14">
          {/* ---------------- at a glance ---------------- */}
          <section data-pdf-block="" className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--color-gold-600,#A8851C)]">Your journey at a glance</p>
              <h2 className="mt-2 font-display text-2xl text-olive-800">The route</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {facts.map((f) => (
                <div key={f.label} className={`rounded-2xl bg-sand-50 px-4 py-4 text-center ring-1 ring-sand-200 ${f.wide ? "col-span-2 flex flex-col justify-center" : ""}`}>
                  <p className={`font-display font-semibold text-olive-800 ${f.wide ? "text-lg leading-snug sm:text-xl" : "text-3xl"}`}>{f.n}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.15em] text-sand-500">{f.label}</p>
                </div>
              ))}
            </div>
            <ol className="relative space-y-3 sm:space-y-0 sm:pl-0">
              {route.map((r, i) => (
                <li key={i} className="flex items-center gap-4 rounded-xl px-1 py-2">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-olive-800 font-display text-sm font-semibold text-[var(--color-gold-200,#EBD9A0)]">{i + 1}</span>
                  <div className="min-w-0 flex-1 border-b border-dashed border-sand-200 pb-2">
                    <p className="font-display text-lg text-olive-800">
                      {r.place}
                      {r.flightIn && (
                        <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-sans uppercase tracking-wide text-[var(--color-gold-600,#A8851C)]">
                          <Line name="plane" className="h-3.5 w-3.5" /> by air
                        </span>
                      )}
                    </p>
                    <p className="truncate text-sm text-sand-500">{r.detail}</p>
                  </div>
                  <p className="shrink-0 text-right text-sm font-semibold text-olive-700">
                    {r.nights} night{r.nights === 1 ? "" : "s"}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          {/* ---------------- about ---------------- */}
          {view.sections.about && (
            <section data-pdf-block="">
              <p className="border-l-2 border-[var(--color-gold-400,#D2AD4C)] pl-5 font-display text-xl italic leading-relaxed text-olive-800 sm:text-xl">{view.sections.about}</p>
            </section>
          )}

          {/* ---------------- day by day ---------------- */}
          <section>
            <div data-pdf-block="">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--color-gold-600,#A8851C)]">Day by day</p>
              <h2 className="mt-2 font-display text-2xl text-olive-800">Your itinerary</h2>
            </div>
            <ol className="mt-8 space-y-10">
              {plan.days.map((d, i) => {
                const lodge = d.property_id && firstDayAt.get(d.property_id) === i ? view.lodges.find((l) => l.id === d.property_id) : null;
                // The day in the order it happens: hotel to the airport, the flight, the airport to the
                // lodge or hotel, then the rest (hotel night, experiences). Transfers are left out when
                // the guests drive themselves or a road is set to no vehicles.
                const keep = (from: string, to: string) => !plan.own_vehicle && plan.route_vehicles?.[routeOf(from, to)] !== 0;
                type Step = { id: string; icon: "jeep" | "plane" | "bed" | "star" | "leaf"; title: string; detail?: string; flight?: boolean };
                const cityTransfers = (d.city_transfers ?? []).filter((t) => keep(t.from_location_id, t.to_location_id));
                const toAirport = cityTransfers.filter((t) => /airport/i.test(t.to_label));
                const fromAirport = cityTransfers.filter((t) => !/airport/i.test(t.to_label));
                const tStep = (t: { from_label: string; to_label: string }, k: string): Step => ({ id: k, icon: "jeep", title: `Transfer: ${t.from_label} to ${t.to_label}` });
                const flightSteps: Step[] = (d.items ?? [])
                  .filter((it) => it.type === "flight" && it.flight)
                  .map((it) => ({
                    id: it.id,
                    icon: "plane",
                    flight: true,
                    title: `Flight ${it.flight!.from} to ${it.flight!.to}`,
                    detail: [
                      it.flight!.airline && it.flight!.number ? `${it.flight!.airline} ${it.flight!.number}` : it.flight!.airline || it.flight!.number,
                      it.flight!.time && `departs ${it.flight!.time}`,
                      it.flight!.arrive && `arrives ${it.flight!.arrive}`,
                      it.flight!.pnr && `PNR ${it.flight!.pnr}`,
                      it.detail,
                    ]
                      .filter(Boolean)
                      .join(" \u00b7 "),
                  }));
                const hours = d.transfer ? view.driveHours[`${d.transfer.from_location_id}|${d.transfer.to_location_id}`] : undefined;
                const roadStep: Step[] =
                  d.transfer && keep(d.transfer.from_location_id, d.transfer.to_location_id) && view.placeNames[d.transfer.from_location_id] && view.placeNames[d.transfer.to_location_id]
                    ? [{ id: "road", icon: "jeep", title: `Transfer: ${view.placeNames[d.transfer.from_location_id]} to ${view.placeNames[d.transfer.to_location_id]}`, ...(hours ? { detail: `Approx. ${hours} hrs drive` } : {}) }]
                    : [];
                const otherSteps: Step[] = (d.items ?? [])
                  .filter((it) => it.type !== "flight" && (it.type !== "note" || it.title))
                  .map((it) => ({ id: it.id, icon: it.type === "hotel" ? "bed" : it.type === "meal" ? "star" : it.type === "transfer" ? "jeep" : "leaf", title: it.title, detail: it.detail || undefined }));
                const steps: Step[] = [
                  ...toAirport.map((t, k) => tStep(t, `out${k}`)),
                  ...flightSteps,
                  ...roadStep,
                  ...fromAirport.map((t, k) => tStep(t, `in${k}`)),
                  ...otherSteps,
                ];
                return (
                  <li key={i} className="space-y-6">
                    <div data-pdf-block="" className="grid gap-4 sm:grid-cols-[110px_1fr]">
                      <div className="flex items-baseline gap-3 sm:block">
                        <p className="font-display text-3xl font-semibold leading-none text-[var(--color-gold-500,#C9A227)]">{pad2(i + 1)}</p>
                        {!view.dateless && (
                          <p className="text-xs uppercase tracking-[0.15em] text-sand-500 sm:mt-2">
                            {fmtDay(d.date)}
                          </p>
                        )}
                      </div>
                      <div>
                        <h3 className="font-display text-xl leading-snug text-olive-800">{d.title}</h3>
                        <p className="mt-2 whitespace-pre-line">{d.text}</p>
                        {d.safaris.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {d.safaris.map((sf, k) => (
                              <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-olive-50 px-3 py-1 text-sm text-olive-800 ring-1 ring-olive-100">
                                <Line name={sf.session === "morning" ? "sun" : "jeep"} className="h-4 w-4 text-olive-600" />
                                {sf.session === "morning" ? "Morning" : sf.session === "full_day" ? "Full-day" : "Evening"} safari &middot; {sf.zone} zone
                                {(sf.jeeps ?? 0) > 1 && <> &middot; {sf.jeeps} jeeps</>}
                              </span>
                            ))}
                          </div>
                        )}
                        {steps.length > 0 && (
                          <ul className="mt-3 space-y-2">
                            {steps.map((st) => (
                              <li key={st.id} className={`flex gap-3 ${st.flight ? "rounded-xl bg-[var(--color-gold-50,#FBF7E9)] px-2 py-1.5 ring-1 ring-[var(--color-gold-300,#DDC277)]" : ""}`}>
                                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-olive-700 ${st.flight ? "bg-white" : "bg-sand-100"}`}>
                                  <Line name={st.icon} className="h-4 w-4" />
                                </span>
                                <span className="min-w-0">
                                  <span className="font-medium text-olive-800">{st.title}</span>
                                  {st.detail && <span className="block text-sm text-sand-600">{st.detail}</span>}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    {lodge && (
                      <div data-pdf-block="" className="-mx-5 bg-sand-50 px-5 py-6 sm:mx-0 sm:rounded-2xl sm:px-8 sm:py-8">
                        <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--color-gold-600,#A8851C)]">Where you stay</p>
                        <h3 className="mt-1 font-display text-2xl text-olive-800">{lodge.name}</h3>
                        {d.park_id && <p className="text-sm text-sand-500">{view.parkNames[d.park_id]}</p>}
                        {(() => {
                          const st = view.stays.find((x) => x.property_id === lodge.id);
                          return st?.room ? (
                            <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 rounded-full bg-white px-3 py-1 text-sm text-olive-800 ring-1 ring-sand-200">
                              <Line name="bed" className="h-4 w-4 text-olive-600" />
                              {st.room}
                              <span className="text-sand-400">&middot;</span>
                              <span className="text-sand-600">{st.meal}</span>
                            </p>
                          ) : null;
                        })()}
                        <PhotoCarousel photos={lodge.photos} label={lodge.name} />
                        {lodge.description && <p className="mt-4 whitespace-pre-line leading-relaxed">{lodge.description}</p>}
                        {lodge.website && (
                          <a
                            href={lodge.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-4 inline-flex items-center gap-2 rounded-full border border-olive-300 px-4 py-2 text-sm font-semibold text-olive-700 hover:bg-white"
                          >
                            Visit the lodge website <Line name="arrow" className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          {/* ---------------- know about the parks: closed on the page (+ opens), open in the PDF ---------------- */}
          {view.parks.some((p) => p.description || p.hero || p.photos.length) && (
            <section className="space-y-4">
              <div data-pdf-block="">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--color-gold-600,#A8851C)]">The wilderness</p>
                <h2 className="mt-2 font-display text-2xl text-olive-800">Know about the parks</h2>
              </div>
              <div className="-mx-5 divide-y divide-sand-200 bg-sand-50 sm:mx-0 sm:rounded-2xl sm:ring-1 sm:ring-sand-200">
                {view.parks
                  .filter((p) => p.description || p.hero || p.photos.length)
                  .map((p) => (
                    <div key={p.id}>
                      {/* on the page */}
                      <details className="park pdf-hide">
                        <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4 sm:px-8">
                          {p.hero && (
                            // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                            <img src={p.hero} alt="" className="h-12 w-16 shrink-0 rounded-lg object-cover" />
                          )}
                          <span className="min-w-0 flex-1 font-display text-xl text-olive-800">{p.name}</span>
                          <span className="plus grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-xl leading-none text-olive-700 ring-1 ring-sand-300 transition" aria-hidden="true">+</span>
                          <span className="sr-only">Show more about {p.name}</span>
                        </summary>
                        <div className="space-y-4 px-5 pb-7 sm:px-8">
                          {p.hero && (
                            // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                            <img src={p.hero} alt={p.name} className="aspect-[16/9] w-full rounded-2xl object-cover" />
                          )}
                          {p.description && <p className="leading-relaxed">{p.description}</p>}
                          {p.photos.length > 0 && (
                            <div>
                              <p className="text-xs font-bold uppercase tracking-[0.2em] text-sand-500">Wildlife of {shortPark(p.name)}</p>
                              <PhotoCarousel photos={p.photos} label={`Wildlife of ${p.name}`} />
                            </div>
                          )}
                          {p.website && (
                            <a href={p.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-olive-300 px-4 py-2 text-sm font-semibold text-olive-700 hover:bg-white">
                              Read more about {shortPark(p.name)} <Line name="arrow" className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </details>
                      {/* in the PDF: open, with three wildlife photos */}
                      <div data-pdf-block="" className="pdf-only gap-4 px-5 py-6 sm:px-8">
                        <h3 className="font-display text-xl text-olive-800">{p.name}</h3>
                        {p.hero && (
                          // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                          <img src={p.hero} alt="" className="aspect-[16/9] w-full rounded-2xl object-cover" />
                        )}
                        {p.description && <p className="leading-relaxed">{p.description}</p>}
                        {p.photos.length > 0 && (
                          <div className="grid grid-cols-3 gap-2">
                            {p.photos.slice(0, 3).map((src, k) => (
                              // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                              <img key={k} src={src} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                            ))}
                          </div>
                        )}
                        {p.website && (
                          <p className="text-sm text-olive-700">
                            Read more: <a href={p.website} className="underline">{p.website.replace(/^https?:\/\/(www\.)?/, "")}</a>
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* ---------------- price ---------------- */}
          {view.show.prices && (
            <section data-pdf-block="" className="-mx-5 bg-[var(--color-olive-900,#2B3318)] px-6 py-8 text-white sm:mx-0 sm:rounded-2xl sm:px-10 sm:py-10">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--color-gold-200,#EBD9A0)]">Trip quotation</p>
              <div className="mt-4 grid gap-6 sm:grid-cols-2 sm:items-end">
                <div>
                  {(() => {
                    const [first, ...rest] = paxLines(view.perPerson, view.split, (n) => money(n, view.currency));
                    return (
                      <>
                        <p className="font-display text-4xl font-semibold text-[var(--color-gold-200,#EBD9A0)]">{first.amount}</p>
                        <p className="mt-1 text-white/75">
                          {first.label} &middot; {view.guests} guest{view.guests === 1 ? "" : "s"}
                        </p>
                        {rest.length > 0 && (
                          <ul className="mt-3 space-y-0.5 text-white/85">
                            {rest.map((l, k) => (
                              <li key={k}>
                                <span className="font-semibold">{l.amount}</span> <span className="text-white/65">{l.label}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="sm:text-right">
                  <p className="text-sm uppercase tracking-[0.15em] text-white/60">Total</p>
                  <p className="font-display text-2xl font-semibold">{money(view.total, view.currency)}</p>
                  <p className="text-sm text-white/60">Valid until {long(view.validUntil)}</p>
                </div>
              </div>
              {view.dateless && <p className="mt-4 text-sm text-white/70">Travel dates are not fixed yet; the price is worked out on the season shown and is confirmed once the dates are known.</p>}
              {view.show.breakup === "detailed" && view.detail.length > 0 && (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-[0.12em] text-white/60">
                        <th className="py-2 pr-3 font-medium">Service</th>
                        <th className="py-2 pr-3 text-right font-medium">Before GST</th>
                        <th className="py-2 pr-3 text-right font-medium">GST</th>
                        <th className="py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.detail.map((r, i) => (
                        <tr key={i} className="border-t border-white/10 align-top">
                          <td className="py-2 pr-3 text-white/85">
                            {r.label}
                            {r.date && !view.dateless && <span className="block text-xs text-white/50">{fmtDay(r.date)}</span>}
                          </td>
                          <td className="tabular py-2 pr-3 text-right">{money(r.net, view.currency)}</td>
                          <td className="tabular py-2 pr-3 text-right text-white/75">
                            {money(r.gst, view.currency)}
                            {r.gstPct != null && r.gstPct > 0 && <span className="block text-xs text-white/50">{r.gstPct}%</span>}
                          </td>
                          <td className="tabular py-2 text-right">{money(r.amount, view.currency)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-white/40 font-semibold text-[var(--color-gold-200,#EBD9A0)]">
                        <td className="py-2.5" colSpan={3}>Total including GST</td>
                        <td className="tabular py-2.5 text-right">{money(view.total, view.currency)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {view.show.breakup === "summary" && view.breakup.length > 0 && (
                <table className="mt-6 w-full text-sm">
                  <tbody>
                    {view.breakup.map((r, i) => (
                      <tr key={i} className={`border-t ${r.gst ? "border-white/40" : "border-white/10"}`}>
                        <td className="py-2 text-white/85">{r.label}</td>
                        <td className="tabular py-2 text-right">{money(r.amount, view.currency)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-white/40 font-semibold text-[var(--color-gold-200,#EBD9A0)]">
                      <td className="py-2.5">Total including GST</td>
                      <td className="tabular py-2.5 text-right">{money(view.total, view.currency)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </section>
          )}

          {/* ---------------- what is included ---------------- */}
          <section data-pdf-block="" className="grid gap-8 sm:grid-cols-2">
            <div>
              <h3 className="font-display text-xl text-olive-800">Included</h3>
              <ul className="mt-4 space-y-2.5">
                {view.sections.inclusions.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <Icon name="check" className="mt-1 h-4 w-4 shrink-0 text-success" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-display text-xl text-olive-800">Not included</h3>
              <ul className="mt-4 space-y-2.5 text-sand-600">
                {view.sections.exclusions.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <Icon name="x" className="mt-1 h-4 w-4 shrink-0 text-sand-400" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* ---------------- payments ---------------- */}
          <section data-pdf-block="" className="border-t border-sand-200 pt-10">
            <h3 className="font-display text-xl text-olive-800">Payment schedule</h3>
            <div className="mt-5 divide-y divide-sand-200 rounded-2xl ring-1 ring-sand-200">
              {view.payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <p className="font-medium text-olive-800">{p.label.charAt(0).toUpperCase() + p.label.slice(1)}</p>
                    <p className="text-sm text-sand-500">{p.due ? `By ${long(p.due)}` : p.note && view.dateless ? p.note.charAt(0).toUpperCase() + p.note.slice(1) : "To confirm the booking"}</p>
                  </div>
                  <p className="tabular font-display text-xl text-olive-800">{view.show.prices ? money(p.amountInCurrency, view.currency) : `${p.pct}%`}</p>
                </div>
              ))}
            </div>
            {view.sections.paymentTerms && <p className="mt-4 whitespace-pre-line text-sm text-sand-600">{view.sections.paymentTerms}</p>}
          </section>

          {view.sections.cancellation.length > 0 && (
            <section data-pdf-block="" className="border-t border-sand-200 pt-10">
              <h3 className="font-display text-xl text-olive-800">Cancellation policy</h3>
              <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-sand-600">
                {view.sections.cancellation.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-gold-500,#C9A227)]" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view.sections.notes.length > 0 && (
            <section data-pdf-block="" className="border-t border-sand-200 pt-10">
              <h3 className="font-display text-xl text-olive-800">Good to know</h3>
              <ul className="mt-5 space-y-3 text-[15px] leading-relaxed text-sand-600">
                {/* the mobile-phone rule is already first (lib/sales/plan/draft.ts) */}
                {view.sections.notes.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-gold-500,#C9A227)]" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ---------------- footer ---------------- */}
        <footer data-pdf-block="" className="bg-[var(--color-olive-900,#2B3318)] px-6 py-10 text-white sm:px-12">
          <p className="font-display text-xl text-[var(--color-gold-200,#EBD9A0)]">We look forward to welcoming you to the wild.</p>

          {/* 1. your safari consultant */}
          {view.consultant.name && (
            <div className="mt-6 text-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-white/50">Your safari consultant</p>
              <p className="mt-1 text-base font-semibold text-white">{view.consultant.name}</p>
              {view.consultant.phone && <p className="text-white/80"><a href={`tel:${view.consultant.phone.replace(/\s+/g, "")}`}>{view.consultant.phone}</a></p>}
              {view.consultant.email && <p className="text-white/80"><a href={`mailto:${view.consultant.email}`}>{view.consultant.email}</a></p>}
            </div>
          )}

          {/* 2. emergency contact: our contacts for every guest (foreign guests also see a teammate, when one is set).
              A phone number or email already shown above is not repeated. */}

          {(dedupedFooter.direct.length > 0 || dedupedFooter.emergency) && (
            <div className="mt-6 border-t border-white/15 pt-6 text-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-white/50">Emergency contact</p>
              {dedupedFooter.emergency && (
                <div className="mt-1">
                  <p className="font-semibold text-white">{dedupedFooter.emergency.name}</p>
                  {dedupedFooter.ePhone && <p className="text-white/80"><a href={`tel:${dedupedFooter.ePhone.replace(/\s+/g, "")}`}>{dedupedFooter.ePhone}</a></p>}
                  {dedupedFooter.eEmail && <p className="text-white/80"><a href={`mailto:${dedupedFooter.eEmail}`}>{dedupedFooter.eEmail}</a></p>}
                </div>
              )}
              <ul className="mt-2 space-y-1 text-white/85">
                {contactLines(dedupedFooter.direct).map((line, k) => (
                  <li key={k}>
                    {line.map((c, j) => (
                      <span key={c}>
                        {j > 0 && ", "}
                        {/@/.test(c) ? <a href={`mailto:${c}`}>{c}</a> : <a href={`tel:${c.replace(/[^\d+]/g, "")}`}>{c}</a>}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* follow us */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {SOCIAL.map((s) => (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                title={s.label}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                  <path d={s.path} />
                </svg>
              </a>
            ))}
          </div>

          <p className="mt-6 text-xs uppercase tracking-[0.18em] text-white/40">
            Quote {view.queryNo} &middot; version {view.versionNo}
          </p>
        </footer>
      </article>

      {/* WhatsApp: always at hand while scrolling; not in print or the PDF */}
      <a
        href={view.whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        title="Chat with us on WhatsApp"
        className="pdf-hide fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-[#25D366] text-white shadow-[0_6px_20px_rgba(0,0,0,0.25)] transition hover:scale-105 print:hidden sm:bottom-8 sm:right-8"
      >
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z" />
        </svg>
      </a>
    </div>
  );
}
