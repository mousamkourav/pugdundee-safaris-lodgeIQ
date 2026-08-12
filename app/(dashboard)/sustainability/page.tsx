import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L } from "@/components/form-bits";
import {
  addTds,
  deleteTds,
  addBreakdown,
  toggleBreakdown,
  deleteBreakdown,
  addPhoto,
  deletePhoto,
} from "./actions";

const CAPTIONS = [
  "Pool",
  "Kitchen",
  "Kitchen Garden",
  "Microgreens",
  "Compost Pit",
  "TDS refilling station",
  "TDS kitchen",
  "Other",
];

function Del({
  action,
  id,
  lodge,
  month,
}: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  lodge: string;
  month: string;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lodge_id" value={lodge} />
      <input type="hidden" name="month" value={month} />
      <button className="text-xs text-error hover:underline">Delete</button>
    </form>
  );
}

export default async function SustainabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Sustainability & photos" />;

  const { start, end, label } = monthRange(month);
  const s = await createClient();

  const { data: tdsData } = await s
    .from("tds_readings")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("entry_date", start)
    .lt("entry_date", end)
    .order("entry_date", { ascending: false });
  const { data: bdData } = await s
    .from("equipment_breakdowns")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("entry_date", start)
    .lt("entry_date", end)
    .order("entry_date", { ascending: false });

  const tds = (tdsData ?? []) as Array<Record<string, number | string | null>>;
  const bd = (bdData ?? []) as Array<Record<string, boolean | string>>;

  // photos (recent, via service-role signed URLs)
  const admin = createAdminClient();
  const { data: photoRows } = await admin
    .from("attachments")
    .select("id,file_path,file_name,extra,created_at")
    .eq("lodge_id", lodge)
    .eq("module", "sustainability")
    .order("created_at", { ascending: false })
    .limit(24);
  const photos: Array<{ id: string; url: string; caption: string }> = [];
  for (const p of (photoRows ?? []) as Array<{
    id: string;
    file_path: string;
    extra: { caption?: string } | null;
  }>) {
    const { data: signed } = await admin.storage
      .from("attachments")
      .createSignedUrl(p.file_path, 3600);
    if (signed?.signedUrl)
      photos.push({
        id: p.id,
        url: signed.signedUrl,
        caption: p.extra?.caption ?? "Photo",
      });
  }

  return (
    <div>
      <PageHeader
        title="Sustainability & photos"
        description={`Water TDS, equipment breakdowns and site photos for ${label}.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      {/* TDS */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Water TDS readings</h2>
        <form
          action={addTds}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Date">
            <input required type="date" name="entry_date" className={inp} />
          </L>
          <L label="Refilling station TDS">
            <input type="number" step="0.01" name="station_tds" className={inp} />
          </L>
          <L label="Kitchen TDS">
            <input type="number" step="0.01" name="kitchen_tds" className={inp} />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "station", label: "Station TDS", className: "tabular" },
            { key: "kitchen", label: "Kitchen TDS", className: "tabular" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={tds.map((r) => ({
            date: r.entry_date,
            station: r.station_tds ?? "—",
            kitchen: r.kitchen_tds ?? "—",
            act: <Del action={deleteTds} id={String(r.id)} lodge={lodge} month={month} />,
          }))}
          empty="No TDS readings this month."
        />
      </section>

      {/* BREAKDOWNS */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Equipment breakdowns</h2>
        <form
          action={addBreakdown}
          className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Date">
            <input required type="date" name="entry_date" className={inp} />
          </L>
          <div className="sm:col-span-2">
            <L label="Description">
              <input required name="description" placeholder="What broke down?" className={inp} />
            </L>
          </div>
          <div className="flex items-end">
            <button className={btn}>Add</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "desc", label: "Description" },
            { key: "status", label: "Status" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={bd.map((r) => ({
            date: r.entry_date,
            desc: r.description,
            status: (
              <form action={toggleBreakdown} className="inline">
                <input type="hidden" name="id" value={String(r.id)} />
                <input type="hidden" name="lodge_id" value={lodge} />
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="resolved" value={String(r.resolved)} />
                <button
                  className={
                    "rounded-full px-2.5 py-0.5 text-xs " +
                    (r.resolved
                      ? "bg-success-bg text-success"
                      : "bg-warning-bg text-warning")
                  }
                >
                  {r.resolved ? "Resolved" : "Open"}
                </button>
              </form>
            ),
            act: <Del action={deleteBreakdown} id={String(r.id)} lodge={lodge} month={month} />,
          }))}
          empty="No breakdowns logged this month."
        />
      </section>

      {/* PHOTOS */}
      <section>
        <h2 className="mb-3 text-lg">Site photos</h2>
        <form
          action={addPhoto}
          className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Caption">
            <select name="caption" className={inp}>
              {CAPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </L>
          <L label="Photo">
            <input type="file" name="photo" accept="image/*" className="text-xs" />
          </L>
          <div className="flex items-end">
            <button className={btn}>Upload</button>
          </div>
        </form>

        {photos.length === 0 ? (
          <div className="rounded-xl border border-sand-200 bg-white p-8 text-center text-sand-500">
            No photos uploaded yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p) => (
              <div
                key={p.id}
                className="overflow-hidden rounded-xl border border-sand-200 bg-white"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.caption}
                  className="h-40 w-full object-cover"
                />
                <div className="flex items-center justify-between p-2">
                  <span className="text-xs text-sand-600">{p.caption}</span>
                  <form action={deletePhoto}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="lodge_id" value={lodge} />
                    <input type="hidden" name="month" value={month} />
                    <button className="text-xs text-error hover:underline">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
