import Link from "next/link";
import { requireRpEditor, loadRpMaster } from "@/lib/redpanda/server";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { MEDIA_BUCKET } from "@/lib/sales/master/types";
import { rupees, fmtDate } from "@/lib/sales/format";
import { ImagesEditor, SettingsEditor, TariffEditor, type ImageRow, type SupplementCell, type TariffCell } from "@/components/redpanda/master-editor";

export const metadata = { title: "Red Panda Master data - LodgeIQ" };

const TABS = [
  { key: "tariff", label: "Tariff" },
  { key: "rules", label: "Rules, airports and text" },
  { key: "photos", label: "Photos" },
  { key: "hotel", label: "Hotel near Bagdogra" },
  { key: "audit", label: "Changes" },
] as const;

export default async function RedPandaMasterPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireRpEditor();
  const want = (await searchParams).tab;
  const tab = TABS.find((t) => t.key === want)?.key ?? "tariff";
  const supabase = await createClient();
  const { master, error } = await loadRpMaster();

  let body: React.ReactNode = null;
  if (!master) body = <p className={ui.alertError}>Could not load Red Panda Master data: {error}. Has supabase/red_panda.sql been run?</p>;
  else if (tab === "tariff") {
    const [t, s] = await Promise.all([
      supabase.from("rp_tariff").select("id, season, valid_from, valid_to, market, guests, per_pax, active"),
      supabase.from("rp_supplements").select("id, season, valid_from, market, kind, amount, active"),
    ]);
    const d10 = (x: unknown) => String(x).slice(0, 10);
    body = (
      <TariffEditor
        tariff={((t.data ?? []) as TariffCell[]).map((r) => ({ ...r, valid_from: d10(r.valid_from), valid_to: d10(r.valid_to), per_pax: Number(r.per_pax) }))}
        supplements={((s.data ?? []) as SupplementCell[]).map((r) => ({ ...r, valid_from: d10(r.valid_from), amount: Number(r.amount) }))}
      />
    );
  } else if (tab === "rules") body = <SettingsEditor settings={master.settings} />;
  else if (tab === "photos") {
    const { data } = await supabase.from("rp_images").select("id, storage_path, caption, is_cover, sort").order("is_cover", { ascending: false }).order("sort");
    const bucket = supabase.storage.from(MEDIA_BUCKET);
    const images: ImageRow[] = ((data ?? []) as { id: string; storage_path: string; caption: string | null; is_cover: boolean; sort: number }[]).map((m) => ({
      id: m.id, url: bucket.getPublicUrl(m.storage_path).data.publicUrl, caption: m.caption, is_cover: m.is_cover, sort: m.sort,
    }));
    body = <ImagesEditor images={images} />;
  } else if (tab === "hotel") {
    const h = master.hotel;
    body = (
      <section className={`${ui.card} space-y-3 p-5 text-sm`}>
        <h3 className="text-lg">{h ? h.name : "No partner hotel found"}</h3>
        <p className="text-sand-500">
          Rooms, rates and the Bagdogra Airport transfer come from Sales Master data (Properties, Room rates, Transfer rates). Change them in{" "}
          <Link className="underline" href="/sales/admin">Sales &gt; Master data</Link>.
        </p>
        {h && (
          <>
            <ul className="space-y-1">
              {h.rooms.map((r) => (
                <li key={r.id}>
                  <b className="text-olive-800">{r.name}</b>:{" "}
                  {r.rates.length ? r.rates.map((x) => `${fmtDate(x.valid_from)} - ${fmtDate(x.valid_to)}: double ${rupees(x.rate_double)}, single ${rupees(x.rate_single ?? x.rate_double)} (${x.meal_plan}, +${x.tax_pct}%)`).join("; ") : <span className="text-error">no rate</span>}
                </li>
              ))}
            </ul>
            <p>Transfer Bagdogra Airport - {h.name}: {h.transfer ? `${rupees(h.transfer.rate)} per ${h.transfer.vehicle_type} (up to ${h.transfer.capacity}) + ${h.transfer.tax_pct}%` : <span className="text-error">no rate</span>}</p>
          </>
        )}
      </section>
    );
  } else {
    const { data } = await supabase.from("rp_audit").select("table_name, action, actor, at, new_row, old_row").order("at", { ascending: false }).limit(50);
    const rows = (data ?? []) as { table_name: string; action: string; at: string; old_row: Record<string, unknown> | null; new_row: Record<string, unknown> | null }[];
    const what = (r: (typeof rows)[number]) => {
      const n = r.new_row ?? r.old_row ?? {};
      if (r.table_name === "rp_tariff") return `${n.season} ${n.market}, ${n.guests} guests: ${r.old_row?.per_pax ?? "-"} to ${r.new_row?.per_pax ?? "-"}`;
      if (r.table_name === "rp_supplements") return `${n.season} ${n.market} ${n.kind}: ${r.old_row?.amount ?? "-"} to ${r.new_row?.amount ?? "-"}`;
      if (r.table_name === "rp_access") return n.role ? `role ${n.role}` : "a person";
      return r.table_name.replace("rp_", "");
    };
    body = (
      <section className={`${ui.card} p-5`}>
        <ul className="divide-y divide-sand-100 text-sm">
          {rows.map((r, i) => (
            <li key={i} className="flex flex-wrap justify-between gap-2 py-2"><span>{r.action}: {what(r)}</span><span className="text-sand-500">{fmtDate(r.at)}</span></li>
          ))}
          {!rows.length && <li className="py-2 text-sand-500">No changes yet.</li>}
        </ul>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Red Panda Outpost</p>
        <h1 className="mt-1 text-2xl">Master data</h1>
      </div>
      <div className="no-scrollbar flex gap-6 overflow-x-auto border-b border-sand-200 text-sm">
        {TABS.map((t) => (
          <Link key={t.key} href={`/red-panda/master?tab=${t.key}`} className={"-mb-px whitespace-nowrap border-b-2 py-3 font-medium " + (tab === t.key ? "border-olive-600 text-olive-800" : "border-transparent text-sand-500 hover:text-olive-800")}>
            {t.label}
          </Link>
        ))}
      </div>
      {body}
    </div>
  );
}
