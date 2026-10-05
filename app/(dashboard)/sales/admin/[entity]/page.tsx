import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ui, Badge } from "@/components/ui";
import { getEntity } from "@/lib/sales/master/entities";
import { withOptions, formatCell } from "@/lib/sales/master/load";

export default async function EntityListPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const entity = getEntity((await params).entity);
  if (!entity) notFound();
  const sp = await searchParams;

  // Resolve dropdown labels only for fields we display or filter on.
  const needed = new Set([...entity.list, ...(entity.filters ?? [])]);
  const fields = await withOptions(entity.fields.filter((f) => needed.has(f.name)));
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

  const active: Record<string, string> = {};
  for (const name of entity.filters ?? []) {
    const v = sp[`f_${name}`];
    if (v) active[name] = v;
  }

  const supabase = await createClient();
  let q = supabase.from(entity.table).select("*");
  if (entity.listFilter) q = entity.listFilter.op === "eq" ? q.eq(entity.listFilter.column, entity.listFilter.value) : q.neq(entity.listFilter.column, entity.listFilter.value);
  for (const [name, v] of Object.entries(active)) q = q.eq(name, v);
  for (const o of entity.order) q = q.order(o.column, { ascending: o.ascending, nullsFirst: false });
  const { data, error } = await q.limit(500);
  const rows = (data ?? []) as Record<string, unknown>[];

  const filterQs = new URLSearchParams(Object.entries(active).map(([k, v]) => [`f_${k}`, v])).toString();
  const newHref = `/sales/admin/${entity.key}/new${filterQs ? "?" + filterQs : ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Link href="/sales/admin" className="text-xs font-medium text-sand-500 hover:text-olive-600">
            Master data
          </Link>
          <h1 className="mt-1 text-2xl">{entity.title}</h1>
          <p className="mt-1 text-sm text-sand-500">{entity.description}</p>
        </div>
        <Link href={newHref} className={ui.btnPrimary}>
          Add {entity.singular}
        </Link>
      </div>

      {(entity.filters ?? []).length > 0 && (
        <form className={`${ui.muted} flex flex-col gap-3 p-4 sm:flex-row sm:items-end`}>
          {(entity.filters ?? []).map((name) => {
            const f = byName[name];
            if (!f) return null;
            return (
              <div key={name} className="sm:w-64">
                <label className={ui.label} htmlFor={`flt_${name}`}>{f.label}</label>
                <select id={`flt_${name}`} name={`f_${name}`} defaultValue={active[name] ?? ""} className={`${ui.select} w-full`}>
                  <option value="">All</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            );
          })}
          <div className="flex gap-2">
            <button className={`${ui.btnSecondary} ${ui.btnSm}`}>Filter</button>
            {filterQs && (
              <Link href={`/sales/admin/${entity.key}`} className={`${ui.btnGhost} ${ui.btnSm}`}>Clear</Link>
            )}
          </div>
        </form>
      )}

      {error && <p className={ui.alertError}>Could not load: {error.message}</p>}

      {rows.length === 0 ? (
        <div className={ui.empty}>
          Nothing here yet. <Link href={newHref} className="font-semibold text-olive-600 underline">Add the first {entity.singular}</Link>.
        </div>
      ) : (
        <div className={`${ui.card} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-sand-100 text-xs font-semibold uppercase tracking-wide text-sand-500">
                  {entity.list.map((name) => (
                    <th key={name} className={"whitespace-nowrap px-4 py-3 " + (byName[name]?.type === "money" ? "text-right" : "")}>
                      {byName[name]?.label ?? name}
                    </th>
                  ))}
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={String(r.id)} className="border-t border-sand-200 hover:bg-sand-50">
                    {entity.list.map((name, i) => {
                      const f = byName[name];
                      const v = r[name];
                      let cell: React.ReactNode = f ? formatCell(f, v) : String(v ?? "-");
                      if (f?.type === "bool" && name === "active") cell = <Badge tone={v ? "success" : "neutral"}>{v ? "Active" : "Inactive"}</Badge>;
                      return (
                        <td key={name} className={"px-4 py-3 " + (f?.type === "money" ? "tabular whitespace-nowrap text-right " : "") + (i === 0 ? "font-medium text-olive-800" : "")}>
                          {cell}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right">
                      <Link href={`/sales/admin/${entity.key}/${r.id}`} className={`${ui.btnGhost} ${ui.btnSm}`}>Edit</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {rows.length === 500 && <p className="text-xs text-sand-500">Showing the first 500. Use the filters to narrow down.</p>}
    </div>
  );
}
