"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ui, Badge } from "@/components/ui";
import { Icon } from "@/components/icons";
import { matchesSearch } from "@/lib/sales/master/search";

// One cell as shown in the list. Plain data so the server page can pass it in.
export interface SearchCell {
  text: string;
  kind: "text" | "money" | "active";
}

export interface SearchRow {
  id: string;
  cells: SearchCell[];
  search: string; // everything the search box looks in, already lower-cased
}

export interface SearchColumn {
  label: string;
  money: boolean;
}

// The master data list with an instant search box. Search runs in the browser
// over the rows already loaded, and the text is kept in the address (?q=) so
// it survives opening a row and coming back.
export function MasterSearchTable({
  entityKey,
  singular,
  columns,
  rows,
  initialQuery,
  newHref,
  truncated,
  placeholder,
}: {
  placeholder: string;
  entityKey: string;
  singular: string;
  columns: SearchColumn[];
  rows: SearchRow[];
  initialQuery: string;
  newHref: string;
  truncated: boolean;
}) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => (query.trim() ? rows.filter((r) => matchesSearch(r.search, query)) : rows), [rows, query]);

  // keep ?q= in the address without reloading the page
  useEffect(() => {
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      if (query.trim()) url.searchParams.set("q", query.trim());
      else url.searchParams.delete("q");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // "/" jumps to the search box (unless already typing somewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const editHref = (id: string) => {
    const q = query.trim();
    return `/sales/admin/${entityKey}/${id}${q ? `?back_q=${encodeURIComponent(q)}` : ""}`;
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-500" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
            }}
            placeholder={placeholder}
            aria-label={`Search ${singular}s`}
            className={`${ui.input} pl-9 pr-9`}
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-sand-500 hover:bg-sand-100 hover:text-olive-700"
              aria-label="Clear search"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="text-xs text-sand-500" aria-live="polite">
          {query.trim() ? `${shown.length} of ${rows.length} match` : `${rows.length} ${rows.length === 1 ? singular : `${singular}s`}`}
        </p>
      </div>

      {shown.length === 0 ? (
        <div className={ui.empty}>
          No {singular}s match &ldquo;{query.trim()}&rdquo;.{" "}
          <button type="button" className="font-semibold text-olive-600 underline" onClick={() => setQuery("")}>
            Clear the search
          </button>{" "}
          or{" "}
          <Link href={newHref} className="font-semibold text-olive-600 underline">
            add a new {singular}
          </Link>
          .
        </div>
      ) : (
        <div className={`${ui.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                  {columns.map((c, i) => (
                    <th key={i} className={"whitespace-nowrap px-4 py-3 " + (c.money ? "text-right" : "")}>
                      {c.label}
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t border-sand-200 hover:bg-sand-50">
                    {r.cells.map((c, i) => (
                      <td key={i} className={"px-4 py-3 " + (c.kind === "money" ? "tabular whitespace-nowrap text-right " : "") + (i === 0 ? "font-medium text-olive-800" : "")}>
                        {c.kind === "active" ? <Badge tone={c.text === "Active" ? "success" : "neutral"}>{c.text}</Badge> : c.text}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right">
                      <Link href={editHref(r.id)} className={`${ui.btnGhost} ${ui.btnSm}`}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {truncated && <p className="text-xs text-sand-500">Only the first {rows.length} are loaded, so the search covers those. Use the filters above to narrow down.</p>}
    </div>
  );
}
