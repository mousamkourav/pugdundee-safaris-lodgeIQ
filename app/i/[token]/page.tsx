import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadClientView } from "@/lib/sales/client-view";
import { DownloadPdfButton } from "@/components/sales/download-pdf";
import { PhotoCarousel } from "@/components/sales/photo-carousel";
import { Icon } from "@/components/icons";
import { dayName } from "@/lib/sales/pricing/dates";

// Guest-facing itinerary. Public: opened from a share link without signing in.
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const view = await loadClientView((await params).token);
  return {
    title: view ? `${view.title} - ${view.guestName} - Pugdundee Safaris` : "Your safari itinerary - Pugdundee Safaris",
    robots: { index: false, follow: false },
  };
}

// Slideshows show as photo grids in the PDF and in print.
const PDF_CSS = `.pdf-only{display:none}
html[data-pdf] .pdf-hide{display:none!important}
html[data-pdf] .pdf-only{display:grid!important}
@media print{.pdf-hide{display:none!important}.pdf-only{display:grid!important}}`;

const fileNameFor = (guest: string, queryNo: string) =>
  `Pugdundee Safaris - ${guest.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Itinerary"} - ${queryNo}.pdf`;

const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const long = (d: string | null) => (d ? LONG.format(new Date(d + "T00:00:00Z")) : "");
const short = (d: string) => SHORT.format(new Date(d + "T00:00:00Z"));

function money(n: number, currency: "INR" | "USD") {
  return new Intl.NumberFormat(currency === "USD" ? "en-US" : "en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "USD" ? 2 : 0,
  }).format(n);
}

export default async function ClientItineraryPage({ params }: { params: Promise<{ token: string }> }) {
  const view = await loadClientView((await params).token);
  if (!view) notFound();
  const { plan } = view;

  // The first day at each lodge shows its photos and description.
  const firstDayAt = new Map<string, number>();
  plan.days.forEach((d, i) => {
    if (d.property_id && !firstDayAt.has(d.property_id)) firstDayAt.set(d.property_id, i);
  });

  return (
    <div className="min-h-screen bg-sand-100 py-0 sm:py-8 print:bg-white print:py-0">
      <style>{PDF_CSS}</style>
      <div className="mx-auto mb-4 flex max-w-4xl justify-end px-4 pt-4 sm:pt-0 print:hidden">
        <DownloadPdfButton fileName={fileNameFor(view.guestName, view.queryNo)} />
      </div>

      <article id="itinerary" className="mx-auto max-w-4xl overflow-hidden bg-white shadow-card sm:rounded-xl print:max-w-none print:shadow-none">
        {/* cover */}
        <header data-pdf-block="cover" className="relative flex min-h-72 items-end bg-olive-800 sm:min-h-96 print:min-h-64">
          {view.heroUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- public storage URL; next/image needs remote config
            <img src={view.heroUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-olive-900/90 via-olive-900/30 to-transparent" />
          <div className="relative p-8 text-white sm:p-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold-200">{view.company.name}</p>
            <h1 className="mt-2 font-display text-3xl font-bold !text-white sm:text-4xl">{view.title}</h1>
            <p className="mt-2 text-white/85">
              Prepared for {view.guestName} &middot; {long(view.arrival)} - {long(view.departure)} &middot; {view.nights + 1} days
            </p>
            <p className="mt-1 text-sm text-white/70">
              Quote {view.queryNo} &middot; quoted on {long(view.quotedOn)}
            </p>
          </div>
        </header>

        <div className="space-y-10 p-6 sm:p-10">
          <section data-pdf-block="">
            <h2 className="text-xl">About this trip</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed">{view.sections.about}</p>
          </section>

          {/* day by day */}
          <section>
            <h2 data-pdf-block="" className="text-xl">Your journey</h2>
            <ol className="mt-6 space-y-8">
              {plan.days.map((d, i) => {
                const lodge = d.property_id && firstDayAt.get(d.property_id) === i ? view.lodges.find((l) => l.id === d.property_id) : null;
                return (
                  <li key={i} data-pdf-block="" className="grid gap-3 break-inside-avoid sm:grid-cols-[130px_1fr]">
                    <div>
                      <p className="font-display font-semibold text-olive-800">Day {i + 1}</p>
                      <p className="text-sm text-sand-500">{dayName(d.date)} {short(d.date)}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-olive-800">{d.title}</p>
                      <p className="mt-1 whitespace-pre-line leading-relaxed">{d.text}</p>
                      {(d.items ?? []).filter((it) => it.type !== "note" || it.title).length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm">
                          {(d.items ?? []).map((it) => (
                            <li key={it.id} className="flex gap-2">
                              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-500" aria-hidden="true" />
                              <span>
                                <span className="font-medium text-olive-800">{it.title}</span>
                                {it.type === "flight" && it.flight && (
                                  <span className="text-sand-600">
                                    {" "}
                                    {[it.flight.airline && it.flight.number ? `${it.flight.airline} ${it.flight.number}` : it.flight.airline || it.flight.number, it.flight.time && `departs ${it.flight.time}`, it.flight.pnr && `PNR ${it.flight.pnr}`]
                                      .filter(Boolean)
                                      .map((x) => `- ${x}`)
                                      .join(" ")}
                                    {!it.flight.pnr && <span className="block text-xs italic text-sand-500">Subject to availability and fares at the time of booking.</span>}
                                  </span>
                                )}
                                {it.detail && <span className="text-sand-600"> - {it.detail}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {lodge && (
                        <div className="mt-4 rounded-xl bg-sand-50 p-4">
                          <p className="font-display font-semibold text-olive-800">{lodge.name}</p>
                          <PhotoCarousel photos={lodge.photos} label={lodge.name} />
                          {lodge.description && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{lodge.description}</p>}
                          {lodge.website && (
                            <a href={lodge.website} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-semibold text-olive-600 underline-offset-2 hover:underline">
                              Visit the {lodge.name} website
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* price (the sales member chooses whether the guest sees prices, and the breakup) */}
          {view.show.prices && (
            <section data-pdf-block="" className="space-y-4 rounded-xl bg-sand-100 p-6 break-inside-avoid">
              <div className="grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="eyebrow">Package price</p>
                  <p className="mt-1 font-display text-3xl font-semibold text-olive-800">{money(view.perPerson, view.currency)}</p>
                  <p className="text-sm text-sand-500">per person &middot; {view.guests} guest{view.guests === 1 ? "" : "s"}</p>
                </div>
                <div className="sm:text-right">
                  <p className="eyebrow">Total</p>
                  <p className="mt-1 font-display text-2xl font-semibold text-olive-800">{money(view.total, view.currency)}</p>
                  <p className="text-sm text-sand-500">Valid until {long(view.validUntil)}</p>
                </div>
              </div>
              {view.show.breakup && view.breakup.length > 0 && (
                <table className="w-full text-sm">
                  <tbody>
                    {view.breakup.map((r, i) => (
                      <tr key={i} className={r.gst ? "border-t border-sand-300" : ""}>
                        <td className="py-1">{r.label}</td>
                        <td className="tabular py-1 text-right">{money(r.amount, view.currency)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-sand-300 font-semibold text-olive-800">
                      <td className="py-1.5">Total including GST</td>
                      <td className="tabular py-1.5 text-right">{money(view.total, view.currency)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </section>
          )}

          <section data-pdf-block="" className="grid gap-8 break-inside-avoid sm:grid-cols-2">
            <div>
              <h3 className="text-lg">Price includes</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {view.sections.inclusions.map((t, i) => (
                  <li key={i} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-success" />{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-lg">Price does not include</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {view.sections.exclusions.map((t, i) => (
                  <li key={i} className="flex gap-2"><Icon name="x" className="mt-0.5 h-4 w-4 shrink-0 text-error" />{t}</li>
                ))}
              </ul>
            </div>
          </section>

          <section data-pdf-block="" className="break-inside-avoid">
            <h3 className="text-lg">Payment schedule</h3>
            <div className="mt-3 overflow-x-auto rounded-xl border border-sand-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                    <th className="px-4 py-3">Instalment</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3 text-right">{view.show.prices ? "Amount" : "Share"}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.payments.map((p, i) => (
                    <tr key={i} className="border-t border-sand-200">
                      <td className="px-4 py-3">{p.label.charAt(0).toUpperCase() + p.label.slice(1)}</td>
                      <td className="px-4 py-3">{p.due ? long(p.due) : "To confirm the booking"}</td>
                      <td className="tabular px-4 py-3 text-right">{view.show.prices ? money(p.amountInCurrency, view.currency) : `${p.pct}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.sections.paymentTerms && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{view.sections.paymentTerms}</p>}
          </section>

          {view.sections.cancellation.length > 0 && (
            <section data-pdf-block="" className="break-inside-avoid">
              <h3 className="text-lg">Cancellation policy</h3>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {view.sections.cancellation.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </section>
          )}

          {view.sections.notes.length > 0 && (
            <section data-pdf-block="" className="break-inside-avoid">
              <h3 className="text-lg">Good to know</h3>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {view.sections.notes.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </section>
          )}
        </div>

        <footer data-pdf-block="" className="flex flex-col gap-2 border-t border-sand-200 bg-sand-50 px-6 py-6 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <div>
            <p className="font-display font-semibold text-olive-800">{view.company.name}</p>
            <p className="text-xs text-sand-500">Quote {view.queryNo} &middot; version {view.versionNo}</p>
          </div>
          <div className="text-sand-600 sm:text-right">
            {view.consultant.name && <p>Your consultant: <b className="text-olive-800">{view.consultant.name}</b>{view.consultant.phone ? ` - ${view.consultant.phone}` : ""}</p>}
            {(view.company.email || view.company.phone) && <p>{[view.company.email, view.company.phone].filter(Boolean).join(" - ")}</p>}
          </div>
        </footer>
      </article>
    </div>
  );
}
