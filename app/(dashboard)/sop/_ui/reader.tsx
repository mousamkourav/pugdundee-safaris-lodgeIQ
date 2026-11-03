// The read view of one SOP version: contents on the left (a dropdown on phones), the section
// on the right, search across all sections with the words highlighted, previous / next, print.
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { ui } from "@/components/ui";
import { highlightParts, queryWords, type SearchHit } from "@/lib/sop/content";
import type { Doc } from "@/lib/sop/types";
import { SopContent } from "./content";
import { TocSelect } from "./toc-select";
import { PrintSection } from "./print-section";

// Printing: only the section, without the app's menus (applies while an SOP page is open).
const PRINT_CSS = "@media print { aside, header, nav, .sop-noprint { display: none !important; } main { padding: 0 !important; } .sop-print-title { display: block !important; } }";

export function SopReader({
  basePath,
  toc,
  section,
  q,
  hits,
  versionLabel,
  top,
  aside,
}: {
  basePath: string; // "/sop" or "/sop/versions/3"
  toc: { id: string; title: string }[];
  section: { id: string; title: string; body: Doc } | null;
  q: string;
  hits: SearchHit[] | null;
  versionLabel: string; // "Version 3 - published 3 Nov 2026"
  top?: ReactNode; // banner, downloads
  aside?: ReactNode; // extra panel under the contents (old versions: what changed)
}) {
  const words = queryWords(q);
  const at = section ? toc.findIndex((t) => t.id === section.id) : -1;
  const prev = at > 0 ? toc[at - 1] : null;
  const next = at >= 0 && at < toc.length - 1 ? toc[at + 1] : null;
  const href = (id: string) => `${basePath}?s=${encodeURIComponent(id)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="space-y-4">
      <style>{PRINT_CSS}</style>
      {top}
      <div className="sop-noprint flex flex-col gap-3 sm:flex-row sm:items-center">
        <form action={basePath} method="get" className="flex flex-1 gap-2" role="search">
          <label htmlFor="sop-q" className="sr-only">
            Search the SOP
          </label>
          <input id="sop-q" name="q" defaultValue={q} placeholder="Search all sections" className={ui.input} enterKeyHint="search" />
          <button className={ui.btnPrimary} aria-label="Search">
            <Icon name="search" className="h-4 w-4" />
            <span className="hidden sm:inline">Search</span>
          </button>
        </form>
        <p className="text-xs text-sand-500">{versionLabel}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* contents: a list on wide screens, a dropdown on phones */}
        <div className="sop-noprint">
          <div className="lg:hidden">
            <TocSelect basePath={basePath} toc={toc} current={section?.id ?? ""} q={q} />
          </div>
          <nav aria-label="SOP contents" className={`${ui.card} hidden max-h-[calc(100vh-180px)] overflow-y-auto p-2 lg:sticky lg:top-20 lg:block`}>
            <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-sand-500">Contents</p>
            <ol className="space-y-0.5">
              {toc.map((t) => {
                const active = t.id === section?.id && !hits;
                return (
                  <li key={t.id}>
                    <Link
                      href={href(t.id)}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-lg px-2 py-1.5 text-sm leading-snug transition ${active ? "bg-olive-600 font-semibold text-white" : "text-sand-700 hover:bg-sand-100"}`}
                    >
                      {t.title}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>
          {aside}
        </div>

        <article className="min-w-0">
          {hits ? (
            <div className={`${ui.card} p-4 sm:p-6`}>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h1 className="text-xl">
                  {hits.length ? `${hits.length} section${hits.length === 1 ? "" : "s"} with "${q}"` : `Nothing found for "${q}"`}
                </h1>
                <Link href={basePath} className="text-sm font-medium text-olive-700 hover:underline">
                  Clear search
                </Link>
              </div>
              {!words.length && <p className="text-sm text-sand-500">Type at least two letters.</p>}
              <ul className="divide-y divide-sand-200">
                {hits.map((h) => (
                  <li key={h.id} className="py-3">
                    <Link href={href(h.id)} className="font-semibold text-olive-800 hover:underline">
                      {highlightParts(h.title, words).map((p, i) => (p.hit ? <mark key={i} className="rounded bg-gold-200 px-0.5">{p.text}</mark> : p.text))}
                    </Link>
                    <span className="ml-2 text-xs text-sand-500">
                      {h.count} match{h.count === 1 ? "" : "es"}
                    </span>
                    {h.snippets.map((s, k) => (
                      <p key={k} className="mt-1 text-sm text-sand-600">
                        {highlightParts(s, words).map((p, i) => (p.hit ? <mark key={i} className="rounded bg-gold-200 px-0.5 text-sand-700">{p.text}</mark> : p.text))}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ) : section ? (
            <div className={`${ui.card} p-4 sm:p-8 print:border-0 print:p-0 print:shadow-none`}>
              <p className="sop-print-title mb-2 hidden text-xs text-sand-500">Pugdundee Safaris SOP - {versionLabel}</p>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-2xl leading-tight">{section.title}</h1>
                <div className="sop-noprint">
                  <PrintSection />
                </div>
              </div>
              {words.length > 0 && (
                <p className="sop-noprint mt-2 text-xs text-sand-500">
                  Highlighted: {words.join(", ")}.{" "}
                  <Link href={`${basePath}?s=${encodeURIComponent(section.id)}`} className="text-olive-700 hover:underline">
                    Remove highlight
                  </Link>
                </p>
              )}
              <SopContent doc={section.body} words={words} className="mt-4" />
              <div className="sop-noprint mt-8 grid gap-3 border-t border-sand-200 pt-4 sm:grid-cols-2">
                {prev ? (
                  <Link href={href(prev.id)} className={`${ui.btnSecondary} justify-start text-left`}>
                    <Icon name="chevronLeft" className="h-4 w-4 shrink-0" />
                    <span className="truncate">{prev.title}</span>
                  </Link>
                ) : (
                  <span />
                )}
                {next && (
                  <Link href={href(next.id)} className={`${ui.btnSecondary} justify-end text-right`}>
                    <span className="truncate">{next.title}</span>
                    <Icon name="arrowRight" className="h-4 w-4 shrink-0" />
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className={ui.empty}>This section is not in this version. Choose one from the contents.</div>
          )}
        </article>
      </div>
    </div>
  );
}
