import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { ENTITIES, ENTITY_GROUPS } from "@/lib/sales/master/entities";

// Suggested order for first-time setup: each step needs the one before it.
const SETUP_ORDER = ["parks", "closures", "locations", "properties", "rooms", "room-rates", "safari-rates", "transfers", "content"];

export default async function MasterDataHub() {
  const supabase = await createClient();
  const counts = await Promise.all(
    ENTITIES.map(async (e) => {
      let q = supabase.from(e.table).select("id", { count: "exact", head: true });
      if (e.listFilter) q = e.listFilter.op === "eq" ? q.eq(e.listFilter.column, e.listFilter.value) : q.neq(e.listFilter.column, e.listFilter.value);
      const { count } = await q;
      return [e.key, count ?? 0] as const;
    })
  );
  const countOf = Object.fromEntries(counts) as Record<string, number>;
  const nextStep = SETUP_ORDER.find((k) => (countOf[k] ?? 0) === 0);
  const nextEntity = ENTITIES.find((e) => e.key === nextStep);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Sales admin</p>
          <h1 className="mt-1 text-2xl">Master data</h1>
          <p className="mt-1 text-sm text-sand-500">Everything the itinerary builder and pricing use. Changes apply to new quotes only; saved quotes keep their prices.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/sales/admin/brand-photos" className={ui.btnSecondary}>
            <Icon name="image" className="h-[18px] w-[18px]" />
            Brand photos
          </Link>
          <Link href="/sales/admin/settings" className={ui.btnSecondary}>
            <Icon name="wrench" className="h-[18px] w-[18px]" />
            Settings
          </Link>
        </div>
      </div>

      {nextEntity && (
        <div className={ui.alertWarning}>
          Setup tip: add <Link href={`/sales/admin/${nextEntity.key}`} className="font-semibold underline">{nextEntity.title.toLowerCase()}</Link> next.
          Suggested order: parks, closures, airports and stations, lodges, rooms, room rates, safari rates, transfers, content.
        </div>
      )}

      {ENTITY_GROUPS.map((group) => (
        <section key={group}>
          <h2 className="mb-3 text-lg">{group}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ENTITIES.filter((e) => e.group === group).map((e) => (
              <Link key={e.key} href={`/sales/admin/${e.key}`} className={`${ui.card} ${ui.cardHover} flex gap-4 p-5 hover:border-olive-600`}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-olive-50 text-olive-600">
                  <Icon name={e.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-semibold text-olive-800">{e.title}</span>
                    <span className="tabular rounded-full bg-sand-100 px-2 py-0.5 text-xs font-semibold text-sand-600">{countOf[e.key] ?? 0}</span>
                  </span>
                  <span className="mt-1 block text-sm text-sand-500">{e.description}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
