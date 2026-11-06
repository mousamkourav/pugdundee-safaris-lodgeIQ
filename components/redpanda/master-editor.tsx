"use client";

// Red Panda Master data (the super admin): the tariff by year, market and group size, the
// supplements, the rules and the guest page text, and the photos (one is the cover).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/image-compress";
import { addRpImage, addTariffYear, rpImageUploadUrl, saveRpSettings, saveSupplement, saveTariffRate, updateRpImage } from "@/app/(dashboard)/red-panda/actions";
import type { Market, RpSettings } from "@/lib/redpanda/types";

export interface TariffCell { id: string; season: string; valid_from: string; valid_to: string; market: Market; guests: number; per_pax: number; active: boolean }
export interface SupplementCell { id: string; season: string; valid_from: string; market: Market; kind: "single_room" | "tour_leader"; amount: number; active: boolean }
export interface ImageRow { id: string; url: string; caption: string | null; is_cover: boolean; sort: number }

const MKT: { key: Market; label: string }[] = [
  { key: "b2b", label: "B2B (agent)" },
  { key: "foreign", label: "B2C foreign" },
  { key: "indian", label: "B2C Indian" },
];

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const run = (fn: () => Promise<{ error?: string; problems?: string[] } | object>, ok = "Saved.") =>
    start(async () => {
      setMsg(null);
      const r = (await fn()) as { error?: string; problems?: string[] };
      if (r.error || r.problems) setMsg({ error: r.error ?? r.problems!.join(" ") });
      else {
        setMsg({ ok });
        router.refresh();
      }
    });
  return { pending, msg, run, setMsg };
}

function Money({ value, onSave, label }: { value: number; onSave: (v: string) => void; label: string }) {
  const [v, setV] = useState(String(value));
  return (
    <input
      aria-label={label}
      className={`${ui.inputSm} tabular w-28 text-right`}
      inputMode="numeric"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== String(value) && onSave(v)}
    />
  );
}

export function TariffEditor({ tariff, supplements }: { tariff: TariffCell[]; supplements: SupplementCell[] }) {
  const { pending, msg, run } = useAct();
  const years = [...new Map(tariff.map((t) => [t.valid_from, t])).values()].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
  const [ny, setNy] = useState({ season: "", from: "", to: "" });
  return (
    <div className="space-y-6">
      {msg && <p className={msg.error ? ui.alertError : ui.alertSuccess}>{msg.error ?? msg.ok}</p>}
      {years.map((y) => (
        <section key={y.valid_from} className={`${ui.card} p-5`}>
          <h3 className="text-lg">Tariff {y.season}</h3>
          <p className="text-sm text-sand-500">{y.valid_from} to {y.valid_to}. Per person for the 5-night package, airport to airport. GST extra.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-sand-500">
                  <th className="py-2 pr-4">Guests together</th>
                  {MKT.map((m) => <th key={m.key} className="py-2 pr-4 text-right">{m.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((g) => (
                  <tr key={g} className="border-t border-sand-100">
                    <td className="py-1.5 pr-4 font-medium text-olive-800">{g}</td>
                    {MKT.map((m) => {
                      const c = tariff.find((t) => t.valid_from === y.valid_from && t.market === m.key && t.guests === g);
                      return (
                        <td key={m.key} className="py-1.5 pr-4 text-right">
                          {c ? <Money label={`${m.label}, ${g} guests`} value={c.per_pax} onSave={(v) => run(() => saveTariffRate(c.id, v, c.active))} /> : <span className="text-error">missing</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {(["single_room", "tour_leader"] as const).map((k) => (
                  <tr key={k} className="border-t border-sand-200">
                    <td className="py-1.5 pr-4 font-medium text-olive-800">{k === "single_room" ? "Single room supplement" : "Tour leader (up to 3 guests)"}</td>
                    {MKT.map((m) => {
                      const c = supplements.find((s) => s.valid_from === y.valid_from && s.market === m.key && s.kind === k);
                      return (
                        <td key={m.key} className="py-1.5 pr-4 text-right">
                          {c ? <Money label={`${m.label}, ${k}`} value={c.amount} onSave={(v) => run(() => saveSupplement(c.id, v, c.active))} /> : <span className="text-error">missing</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <section className={`${ui.muted} p-5`}>
        <h3 className="text-base">Add a new year</h3>
        <p className="text-sm text-sand-500">Copies the latest year&apos;s rates with the new dates; then change the rates above.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input className={ui.inputSm} placeholder="Name, e.g. 2027-28" value={ny.season} onChange={(e) => setNy({ ...ny, season: e.target.value })} />
          <input className={ui.inputSm} type="date" aria-label="First day" value={ny.from} onChange={(e) => setNy({ ...ny, from: e.target.value })} />
          <input className={ui.inputSm} type="date" aria-label="Last day" value={ny.to} onChange={(e) => setNy({ ...ny, to: e.target.value })} />
          <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={pending} onClick={() => run(() => addTariffYear(ny.season, ny.from, ny.to), "Year added.")}>Add year</button>
        </div>
      </section>
    </div>
  );
}

const lines = (a: string[]) => a.join("\n");
const unlines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function SettingsEditor({ settings }: { settings: RpSettings }) {
  const { pending, msg, run } = useAct();
  const [s, setS] = useState(settings);
  const [lists, setLists] = useState({ inclusions: lines(settings.inclusions), exclusions: lines(settings.exclusions), good_to_know: lines(settings.good_to_know), what_to_carry: lines(settings.what_to_carry) });
  const numF: [keyof RpSettings, string][] = [
    ["gst_pct", "GST % on the package"],
    ["package_nights", "Package nights"],
    ["min_nights", "Fewest nights"],
    ["max_nights", "Most nights"],
    ["max_guests", "Most guests"],
    ["max_rooms", "Rooms at the Outpost"],
    ["min_age", "Youngest age"],
    ["deposit_pct", "Deposit % at booking"],
    ["balance_days_before", "Balance due, days before arrival"],
  ];
  const save = () =>
    run(() =>
      saveRpSettings(
        JSON.stringify({
          ...Object.fromEntries(numF.map(([k]) => [k, s[k]])),
          airports: s.airports,
          hotel_property: s.hotel_property,
          title: s.title,
          tagline: s.tagline,
          intro: s.intro,
          stay_text: s.stay_text,
          payment_terms: s.payment_terms,
          days: s.days,
          inclusions: unlines(lists.inclusions),
          exclusions: unlines(lists.exclusions),
          good_to_know: unlines(lists.good_to_know),
          what_to_carry: unlines(lists.what_to_carry),
        })
      )
    );
  const area = (label: string, value: string, on: (v: string) => void, rows = 4, hint?: string) => (
    <label className="block">
      <span className={ui.label}>{label}</span>
      <textarea className={ui.input} rows={rows} value={value} onChange={(e) => on(e.target.value)} />
      {hint && <span className="mt-1 block text-xs text-sand-500">{hint}</span>}
    </label>
  );
  return (
    <div className="space-y-6">
      <section className={`${ui.card} space-y-4 p-5`}>
        <h3 className="text-lg">Rules</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {numF.map(([k, label]) => (
            <label key={k} className="block">
              <span className={ui.label}>{label}</span>
              <input className={ui.inputSm} type="number" value={String(s[k])} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} />
            </label>
          ))}
          <label className="block">
            <span className={ui.label}>Partner hotel near Bagdogra</span>
            <input className={ui.inputSm} value={s.hotel_property} onChange={(e) => setS({ ...s, hotel_property: e.target.value })} />
            <span className="mt-1 block text-xs text-sand-500">Part of its name in Sales Master data; its rooms, rates and transfer come from there.</span>
          </label>
        </div>
        <p className="text-sm text-sand-500">Closed every year June to September (monsoon). Cancellation: the regular Sales cancellation policy.</p>
      </section>

      <section className={`${ui.card} space-y-4 p-5`}>
        <h3 className="text-lg">Airports and transfers</h3>
        {s.airports.map((a, i) => (
          <div key={a.code} className="grid gap-2 sm:grid-cols-[60px_1fr_100px]">
            <span className="self-center font-semibold text-olive-800">{a.code}</span>
            <input className={ui.inputSm} aria-label={`${a.code} name`} value={a.name} onChange={(e) => setS({ ...s, airports: s.airports.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input className={ui.inputSm} aria-label={`${a.code} hours`} type="number" step="0.5" value={a.hours} onChange={(e) => setS({ ...s, airports: s.airports.map((x, j) => (j === i ? { ...x, hours: Number(e.target.value) } : x)) })} />
          </div>
        ))}
        <p className="text-xs text-sand-500">The drive in hours to the Outpost. The transfer itself is in the package.</p>
      </section>

      <section className={`${ui.card} space-y-4 p-5`}>
        <h3 className="text-lg">Guest page text</h3>
        <label className="block"><span className={ui.label}>Title</span><input className={ui.input} value={s.title} onChange={(e) => setS({ ...s, title: e.target.value })} /></label>
        <label className="block"><span className={ui.label}>Line under the title</span><input className={ui.input} value={s.tagline} onChange={(e) => setS({ ...s, tagline: e.target.value })} /></label>
        {area("Introduction", s.intro, (v) => setS({ ...s, intro: v }), 5)}
        {area("The stay", s.stay_text, (v) => setS({ ...s, stay_text: v }), 4)}
        {s.days.map((d, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-sand-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-sand-500">{["Arrival day", "Each day at the Outpost", "Departure day"][i]}</p>
            <input className={ui.inputSm} value={d.title} onChange={(e) => setS({ ...s, days: s.days.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
            <textarea className={ui.input} rows={4} value={d.text} onChange={(e) => setS({ ...s, days: s.days.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
          </div>
        ))}
        <p className="text-xs text-sand-500">Words in braces are filled in: {"{airport}"}, {"{hours}"}, {"{departure_airport}"}, {"{nights}"}, {"{days}"}, {"{expedition_days}"}, {"{deposit_pct}"}, {"{balance_pct}"}, {"{balance_days}"}.</p>
        {area("Includes (one per line)", lists.inclusions, (v) => setLists({ ...lists, inclusions: v }), 8)}
        {area("Does not include (one per line)", lists.exclusions, (v) => setLists({ ...lists, exclusions: v }), 6)}
        {area("Good to know (one per line)", lists.good_to_know, (v) => setLists({ ...lists, good_to_know: v }), 10)}
        {area("What to carry (one per line)", lists.what_to_carry, (v) => setLists({ ...lists, what_to_carry: v }), 6)}
        {area("Payment terms", s.payment_terms, (v) => setS({ ...s, payment_terms: v }), 2)}
      </section>
      {msg && <p className={msg.error ? ui.alertError : ui.alertSuccess}>{msg.error ?? msg.ok}</p>}
      <button type="button" className={ui.btnPrimary} disabled={pending} onClick={save}>{pending ? "Saving..." : "Save rules and text"}</button>
    </div>
  );
}

export function ImagesEditor({ images }: { images: ImageRow[] }) {
  const { pending, msg, run, setMsg } = useAct();
  const [busy, setBusy] = useState(false);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const f of Array.from(files).slice(0, 10)) {
        const blob = await compressImage(f);
        const name = f.name.replace(/\.[^.]+$/, "") + ".jpg";
        const up = await rpImageUploadUrl(name, blob.size);
        if (up.error || !up.path || !up.token) throw new Error(up.error ?? "No upload link.");
        const { error } = await createClient().storage.from("sales-media").uploadToSignedUrl(up.path, up.token, blob, { contentType: "image/jpeg" });
        if (error) throw new Error(error.message);
        const r = await addRpImage(up.path, "");
        if (r.error) throw new Error(r.error);
      }
      run(async () => ({}), "Photos added.");
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={`${ui.card} space-y-4 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg">Photos</h3>
        <label className={`${ui.btnSecondary} ${ui.btnSm} cursor-pointer`}>
          <Icon name="image" className="h-4 w-4" />
          {busy ? "Uploading..." : "Add photos"}
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files)} />
        </label>
      </div>
      <p className="text-sm text-sand-500">The cover photo opens the guest page and the PDF; the others show in the stay section.</p>
      {msg && <p className={msg.error ? ui.alertError : ui.alertSuccess}>{msg.error ?? msg.ok}</p>}
      {images.length === 0 && <div className={ui.empty}>No photos yet.</div>}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.map((m) => (
          <li key={m.id} className="space-y-2 rounded-lg border border-sand-200 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt={m.caption ?? ""} className="aspect-[4/3] w-full rounded-md object-cover" />
            <input className={ui.inputSm} defaultValue={m.caption ?? ""} placeholder="Caption" onBlur={(e) => e.target.value !== (m.caption ?? "") && run(() => updateRpImage(m.id, { caption: e.target.value }))} />
            <div className="flex flex-wrap gap-2">
              {m.is_cover ? (
                <span className="rounded-md border border-gold-200 bg-gold-50 px-2 py-1 text-xs font-semibold text-gold-800">Cover</span>
              ) : (
                <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={pending} onClick={() => run(() => updateRpImage(m.id, { cover: true }))}>Make cover</button>
              )}
              <button type="button" className={`${ui.btnDangerOutline} ${ui.btnSm}`} disabled={pending} onClick={() => window.confirm("Remove this photo?") && run(() => updateRpImage(m.id, { remove: true }), "Removed.")}>Remove</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
