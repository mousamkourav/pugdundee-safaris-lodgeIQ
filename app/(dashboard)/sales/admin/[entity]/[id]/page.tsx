import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEntity } from "@/lib/sales/master/entities";
import { withOptions } from "@/lib/sales/master/load";
import { MasterForm } from "@/components/sales/master-form";
import { saveRecord, deleteRecord } from "../../actions";

export default async function EntityEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ entity: string; id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { entity: key, id } = await params;
  const entity = getEntity(key);
  if (!entity) notFound();
  const isNew = id === "new";
  const sp = await searchParams;

  let values: Record<string, unknown> = {};
  if (isNew) {
    for (const f of entity.fields) if (f.initial !== undefined) values[f.name] = f.initial;
    // Prefill from the list filters (e.g. adding a room while filtered to one lodge).
    for (const name of entity.filters ?? []) {
      const v = sp[`f_${name}`];
      if (v) values[name] = v;
    }
  } else {
    const supabase = await createClient();
    const { data } = await supabase.from(entity.table).select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    values = data as Record<string, unknown>;
  }

  const fields = await withOptions(entity.fields);
  const listHref = `/sales/admin/${entity.key}`;
  const heading = isNew ? `Add ${entity.singular}` : String(values.name ?? values.title ?? values.label ?? `Edit ${entity.singular}`);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <nav className="flex flex-wrap items-center gap-1.5 text-xs text-sand-500">
          <Link href="/sales/admin" className="hover:text-olive-600">Master data</Link>
          <span aria-hidden="true">/</span>
          <Link href={listHref} className="hover:text-olive-600">{entity.title}</Link>
        </nav>
        <h1 className="mt-1 text-2xl">{heading}</h1>
      </div>
      <MasterForm
        fields={fields}
        values={values}
        action={saveRecord.bind(null, entity.key, isNew ? null : id)}
        deleteAction={isNew ? undefined : deleteRecord.bind(null, entity.key, id)}
        deleteWarning={entity.deleteWarning}
        backHref={listHref}
        afterSaveHref={listHref}
        submitLabel={isNew ? `Add ${entity.singular}` : "Save changes"}
      />
    </div>
  );
}
