// The Red Panda Outpost guest page (and its PDF): its own cover, colours and wording, apart from
// the Safari page. Colours are the Red Panda brochure's (cream paper, bark brown ink, a lichen-gold
// accent), set as page-scoped variables. Server component; the PDF button captures [data-pdf-block].
import { DownloadPdfButton } from "@/components/sales/download-pdf";
import { ShareButtons } from "@/components/sales/share-buttons";
import { fmtDay } from "@/lib/sales/format";
import type { RpClientView } from "@/lib/redpanda/client-view";

// the brochure's palette (Red_Panda_Outpost.pdf), only on this page
const RP_CSS = `.rp{--rp-paper:#F9F3F1;--rp-paper-2:#F4EBE9;--rp-ink:#4B383A;--rp-bark:#543526;--rp-accent:#A6916A;--rp-line:#E2D5D1}
.pdf-only{display:none}
html[data-pdf] .pdf-hide{display:none!important}
html[data-pdf] #itinerary{width:820px!important;max-width:none!important;border-radius:0!important;font-size:15px}
html[data-pdf] [data-pdf-block="cover"]{min-height:0!important;height:auto!important;aspect-ratio:210/297}
@media print{.pdf-hide{display:none!important}}`;

const LONG = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const long = (d: string | null) => (d ? LONG.format(new Date(`${d}T00:00:00Z`)) : "");
const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const fileName = (guest: string, start: string | null) =>
  ["Red Panda Outpost", start ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${start}T00:00:00Z`)) : "", guest.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Itinerary"]
    .filter(Boolean)
    .join(" - ") + ".pdf";

function Heading({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.25em] text-[var(--rp-accent)]">{kicker}</p>
      <h2 className="mt-2 font-display text-2xl !text-[var(--rp-bark)]">{title}</h2>
    </div>
  );
}

function List({ items, mark = "dot" }: { items: string[]; mark?: "dot" | "no" }) {
  return (
    <ul className="space-y-2">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden="true" className={"mt-2 h-1.5 w-1.5 shrink-0 rounded-full " + (mark === "no" ? "bg-[var(--rp-line)] ring-1 ring-[var(--rp-accent)]" : "bg-[var(--rp-accent)]")} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

export function RedPandaGuestPage({ view }: { view: RpClientView }) {
  const c = view.content;
  const contacts = [view.consultant, view.emergency].filter((x): x is NonNullable<typeof x> => !!x && !!(x.name || x.phone || x.email));
  return (
    <div className="rp min-h-screen bg-[var(--rp-paper-2)] text-[17px] leading-relaxed text-[var(--rp-ink)] sm:py-8 sm:text-base print:bg-white print:py-0">
      <style>{RP_CSS}</style>
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-0 sm:pt-0 print:hidden">
        <ShareButtons title={`${c.title} - Pugdundee Safaris`} text={`Red Panda Outpost itinerary for ${view.guestName} from ${view.company.name}`} />
        <DownloadPdfButton fileName={fileName(view.guestName, c.arrival)} />
      </div>

      <article id="itinerary" className="mx-auto max-w-4xl overflow-hidden bg-[var(--rp-paper)] shadow-card sm:rounded-2xl print:max-w-none print:shadow-none">
        {/* ---------------- cover ---------------- */}
        <header data-pdf-block="cover" className="relative flex min-h-[88vh] flex-col justify-between bg-[var(--rp-bark)] text-white sm:min-h-[640px] print:min-h-[960px]">
          {view.cover && (
            // eslint-disable-next-line @next/next/no-img-element -- public storage URL
            <img src={view.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/5 to-[rgba(56,30,20,0.88)]" />
          <div className="relative flex items-center justify-between px-6 pt-6 sm:px-12 sm:pt-10">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/90">{view.company.name}</p>
            <p className="hidden text-xs uppercase tracking-[0.2em] text-white/75 sm:block">Singalila, Eastern Himalaya</p>
          </div>
          <div className="relative px-6 pb-10 sm:px-12 sm:pb-14">
            <p className="text-xs uppercase tracking-[0.3em] text-[var(--rp-paper-2)]">A Himalayan journey prepared for</p>
            <p className="mt-1 font-display text-2xl font-semibold leading-tight !text-white sm:text-3xl">{view.guestName}</p>
            <h1 className="mt-5 max-w-3xl font-display text-[2.3rem] font-semibold leading-[1.05] !text-white sm:text-6xl">{c.title}</h1>
            <p className="mt-4 font-display text-lg italic text-[var(--rp-paper-2)] sm:text-xl">In search of the red panda</p>
            <div className="mt-6 h-px w-24 bg-[var(--rp-accent)]" />
            <p className="mt-5 text-base text-white/90 sm:text-lg">
              {c.arrival ? <>{long(c.arrival)} &ndash; {long(c.departure)}</> : "Travel dates to be confirmed"}
              <span className="mx-2 text-white/50">|</span>
              {c.nights + 1} days
              <span className="mx-2 text-white/50">|</span>
              {c.guests} guest{c.guests === 1 ? "" : "s"}
              <span className="mx-2 text-white/50">|</span>
              {c.rooms} room{c.rooms === 1 ? "" : "s"}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-white/65">Quote {view.queryNo} &middot; prepared {long(view.quotedOn)}</p>
          </div>
        </header>

        <div className="space-y-14 px-5 py-10 sm:px-12 sm:py-14">
          {/* ---------------- at a glance ---------------- */}
          <section data-pdf-block="" className="space-y-6">
            <Heading kicker="Your journey at a glance" title={c.tagline || c.title} />
            {c.intro && <p className="max-w-3xl">{c.intro}</p>}
            <dl className="grid gap-x-8 gap-y-3 rounded-2xl border border-[var(--rp-line)] bg-white/60 p-5 sm:grid-cols-2 sm:p-6">
              {c.glance.map((g) => (
                <div key={g.label}>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--rp-accent)]">{g.label}</dt>
                  <dd className="font-medium text-[var(--rp-bark)]">{g.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* ---------------- day by day ---------------- */}
          <section className="space-y-6">
            <div data-pdf-block="">
              <Heading kicker="Day by day" title="Your itinerary" />
            </div>
            <ol className="space-y-6">
              {c.days.map((d) => (
                <li key={d.n} data-pdf-block="" className="grid gap-3 border-l-2 border-[var(--rp-accent)] pl-5 sm:grid-cols-[120px_1fr] sm:border-l-0 sm:pl-0">
                  <div>
                    <p className="font-display text-lg font-semibold text-[var(--rp-bark)]">Day {d.n}</p>
                    {d.dateText && <p className="text-sm text-[var(--rp-accent)]">{d.dateText}</p>}
                  </div>
                  <div className="sm:border-l sm:border-[var(--rp-line)] sm:pl-6">
                    <h3 className="font-display text-lg !text-[var(--rp-bark)]">{d.title}</h3>
                    <p className="mt-1">{d.text}</p>
                    {d.stay && <p className="mt-2 text-sm font-medium text-[var(--rp-accent)]">Overnight: {d.stay}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ---------------- the stay ---------------- */}
          {(c.stayText || view.photos.length > 0) && (
            <section data-pdf-block="" className="space-y-5">
              <Heading kicker="Your stay" title="Red Panda Outpost" />
              {c.stayText && <p className="max-w-3xl">{c.stayText}</p>}
              {view.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {view.photos.slice(0, 6).map((p, i) => (
                    <figure key={i} className="overflow-hidden rounded-xl bg-[var(--rp-paper-2)]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- public storage URL */}
                      <img src={p.url} alt={p.caption ?? ""} className="aspect-[4/3] w-full object-cover" />
                      {p.caption && <figcaption className="px-3 py-2 text-xs">{p.caption}</figcaption>}
                    </figure>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ---------------- price ---------------- */}
          <section data-pdf-block="" className="space-y-5 rounded-2xl bg-[var(--rp-paper-2)] p-5 sm:p-8">
            <Heading kicker="Your investment" title="Price" />
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--rp-line)] pb-4">
              <div>
                <p className="font-display text-3xl font-semibold text-[var(--rp-bark)] sm:text-4xl">{inr(view.total)}</p>
                <p className="text-sm">for {c.guests} guest{c.guests === 1 ? "" : "s"}, GST included ({inr(view.perPerson)} per person)</p>
              </div>
              <p className="text-xs">Valid until {long(view.validUntil)}</p>
            </div>
            <ul className="space-y-2 text-sm">
              {view.breakup.map((b, i) => (
                <li key={i} className="flex justify-between gap-4"><span>{b.label}</span><span className="tabular shrink-0 font-medium text-[var(--rp-bark)]">{inr(b.amount)}</span></li>
              ))}
            </ul>
            {view.payments.length > 0 && (
              <div className="rounded-xl border border-[var(--rp-line)] bg-white/70 p-4 text-sm">
                <p className="font-semibold text-[var(--rp-bark)]">Payment</p>
                {view.payments.map((p) => (
                  <p key={p.label} className="mt-1 flex justify-between gap-4"><span>{p.label}{p.due ? ` by ${fmtDay(p.due)}` : " at booking"}</span><span className="tabular">{inr(p.amount)}</span></p>
                ))}
                {c.paymentTerms && <p className="mt-2 text-xs">{c.paymentTerms}</p>}
              </div>
            )}
          </section>

          {/* ---------------- includes ---------------- */}
          <section data-pdf-block="" className="grid gap-8 sm:grid-cols-2">
            <div className="space-y-4">
              <Heading kicker="Included" title="What the price includes" />
              <List items={c.inclusions} />
            </div>
            <div className="space-y-4">
              <Heading kicker="Not included" title="What it does not include" />
              <List items={c.exclusions} mark="no" />
            </div>
          </section>

          {/* ---------------- good to know ---------------- */}
          {c.goodToKnow.length > 0 && (
            <section data-pdf-block="" className="space-y-4">
              <Heading kicker="Before you go" title="Good to know" />
              <List items={c.goodToKnow} />
            </section>
          )}
          {c.whatToCarry.length > 0 && (
            <section data-pdf-block="" className="space-y-4">
              <Heading kicker="Packing" title="What to carry" />
              <List items={c.whatToCarry} />
            </section>
          )}

          {/* ---------------- terms ---------------- */}
          {view.cancellation.length > 0 && (
            <section data-pdf-block="" className="space-y-4">
              <Heading kicker="Terms" title="Cancellation" />
              <List items={view.cancellation} />
            </section>
          )}

          {/* ---------------- contacts ---------------- */}
          <section data-pdf-block="" className="space-y-5 border-t border-[var(--rp-line)] pt-10">
            <Heading kicker="We are here for you" title="Contacts" />
            <div className="grid gap-4 sm:grid-cols-2">
              {contacts.map((p, i) => (
                <div key={i} className="rounded-xl border border-[var(--rp-line)] bg-white/60 p-4 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--rp-accent)]">{i === 0 ? "Your travel consultant" : "Emergency contact"}</p>
                  <p className="mt-1 font-semibold text-[var(--rp-bark)]">{p.name}</p>
                  {p.phone && <p><a className="underline" href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>{p.phone}</a></p>}
                  {p.email && <p><a className="underline" href={`mailto:${p.email}`}>{p.email}</a></p>}
                </div>
              ))}
            </div>
            <p className="text-sm">{view.company.name}: {view.directContacts.join(", ")}</p>
          </section>
        </div>
      </article>

      <a
        href={view.whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        className="pdf-hide fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[#25D366] p-3.5 sm:px-5 sm:py-3 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(0,0,0,0.25)] print:hidden sm:bottom-8 sm:right-8"
      >
        <svg viewBox="0 0 24 24" className="h-7 w-7 sm:h-5 sm:w-5" fill="currentColor" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.6.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z" />
        </svg>
        <span className="hidden sm:inline">WhatsApp us</span>
      </a>
    </div>
  );
}
