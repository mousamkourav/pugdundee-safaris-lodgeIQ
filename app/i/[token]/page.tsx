import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadClientView } from "@/lib/sales/client-view";
import { PrintButton } from "@/components/sales/print-button";
import { Icon } from "@/components/icons";
import { dayName } from "@/lib/sales/pricing/dates";

// Guest-facing itinerary. Public: opened from a share link without signing in.
export const metadata: Metadata = {
  title: "Your safari itinerary - Pugdundee Safaris",
  robots: { index: false, follow: false },
};

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
      <div className="mx-auto mb-4 flex max-w-4xl justify-end px-4 print:hidden">
        <PrintButton />
      </div>

      <article className="mx-auto max-w-4xl overflow-hidden bg-white shadow-card sm:rounded-xl print:max-w-none print:shadow-none">
        {/* cover */}
        <header className="relative flex min-h-72 items-end bg-olive-800 sm:min-h-96 print:min-h-64">
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
          </div>
        </header>

        <div className="space-y-10 p-6 sm:p-10">
          <section>
            <h2 className="text-xl">About this trip</h2>
            <p className="mt-3 whitespace-pre-line leading-relaxed">{view.sections.about}</p>
          </section>

          {/* day by day */}
          <section>
            <h2 className="text-xl">Your journey</h2>
            <ol className="mt-6 space-y-8">
              {plan.days.map((d, i) => {
                const lodge = d.property_id && firstDayAt.get(d.property_id) === i ? view.lodges.find((l) => l.id === d.property_id) : null;
                return (
                  <li key={i} className="grid gap-3 break-inside-avoid sm:grid-cols-[130px_1fr]">
                    <div>
                      <p className="font-display font-semibold text-olive-800">Day {i + 1}</p>
                      <p className="text-sm text-sand-500">{dayName(d.date)} {short(d.date)}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-olive-800">{d.title}</p>
                      <p className="mt-1 whitespace-pre-line leading-relaxed">{d.text}</p>
                      {lodge && (
                        <div className="mt-4 rounded-xl bg-sand-50 p-4">
                          <p className="font-display font-semibold text-olive-800">{lodge.name}</p>
                          {lodge.photos.length > 0 && (
                            <div className={"mt-3 grid gap-2 " + (lodge.photos.length > 1 ? "grid-cols-3" : "grid-cols-1")}>
                              {lodge.photos.map((src, k) => (
                                // eslint-disable-next-line @next/next/no-img-element -- public storage URL
                                <img key={k} src={src} alt="" className={"w-full rounded-lg object-cover " + (lodge.photos.length > 1 ? "aspect-[4/3]" : "aspect-[16/9]")} />
                              ))}
                            </div>
                          )}
                          {lodge.description && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{lodge.description}</p>}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* price */}
          <section className="grid gap-6 rounded-xl bg-sand-100 p-6 break-inside-avoid sm:grid-cols-2">
            <div>
              <p className="eyebrow">Package price</p>
              <p className="mt-1 font-display text-3xl font-semibold text-olive-800">{money(view.perPerson, view.currency)}</p>
              <p className="text-sm text-sand-500">per person &middot; {view.guests} guest{view.guests === 1 ? "" : "s"}</p>
            </div>
            <div className="sm:text-right">
              <p className="eyebrow">Total</p>
              <p className="mt-1 font-display text-2xl font-semibold text-olive-800">{money(view.total, view.currency)}</p>
              <p className="text-sm text-sand-500">Quote {view.queryNo} &middot; valid until {long(view.validUntil)}</p>
            </div>
          </section>

          <section className="grid gap-8 break-inside-avoid sm:grid-cols-2">
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

          <section className="break-inside-avoid">
            <h3 className="text-lg">Payment schedule</h3>
            <div className="mt-3 overflow-x-auto rounded-xl border border-sand-200">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                    <th className="px-4 py-3">Instalment</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {view.payments.map((p, i) => (
                    <tr key={i} className="border-t border-sand-200">
                      <td className="px-4 py-3">{p.label.charAt(0).toUpperCase() + p.label.slice(1)}</td>
                      <td className="px-4 py-3">{p.due ? long(p.due) : "To confirm the booking"}</td>
                      <td className="tabular px-4 py-3 text-right">{money(p.amountInCurrency, view.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view.sections.paymentTerms && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{view.sections.paymentTerms}</p>}
          </section>

          {view.sections.cancellation.length > 0 && (
            <section className="break-inside-avoid">
              <h3 className="text-lg">Cancellation policy</h3>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {view.sections.cancellation.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </section>
          )}

          {view.sections.notes.length > 0 && (
            <section className="break-inside-avoid">
              <h3 className="text-lg">Good to know</h3>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                {view.sections.notes.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            </section>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-sand-200 bg-sand-50 px-6 py-6 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-10">
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
