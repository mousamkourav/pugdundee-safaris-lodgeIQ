import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEntity } from "@/lib/sales/master/entities";
import { withOptions } from "@/lib/sales/master/load";
import { MasterForm } from "@/components/sales/master-form";
import { MediaManager } from "@/components/sales/media-manager";
import { getMedia } from "@/lib/sales/media";
import { ui } from "@/components/ui";
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
  if (isNew && entity.noCreate) notFound();
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
  const media = entity.media && !isNew ? await getMedia(entity.media.owner, id) : [];
  // Back to the list with the search that was open (from the list's Edit link).
  const backQ = (sp.back_q ?? "").trim().slice(0, 100);
  const listHref = `/sales/admin/${entity.key}${backQ ? `?q=${encodeURIComponent(backQ)}` : ""}`;
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
      {entity.media &&
        (isNew ? (
          <p className={ui.muted + " p-4 text-sm text-sand-500"}>Save first, then you can add photos.</p>
        ) : (
          entity.key === "parks" ? (
            // a park: one main image (the hero of "Know about the parks") and a wildlife slideshow
            <>
              <MediaManager owner="park" ownerId={id} items={media.filter((m) => m.is_cover)} max={1} mode="cover" title="Main image" hint="The large picture at the top of this park in Know about the parks, on the guest itinerary and PDF. A wide landscape photo works best." />
              <MediaManager owner="park" ownerId={id} items={media.filter((m) => !m.is_cover)} max={entity.media.max - 1} mode="rest" title="Wildlife photos" hint="The slideshow under the park's description (the PDF shows the first three). Use the arrows to change the order." />
            </>
          ) : (
            <MediaManager owner={entity.media.owner} ownerId={id} items={media} max={entity.media.max} />
          )
        ))}
    </div>
  );
}
