import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { LodgePicker } from "@/components/lodge-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L } from "@/components/form-bits";
import { addAgent, deleteAgent } from "./actions";

export default async function TravelAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  if (!lodge) return <NoLodge title="Travel agents" />;

  const s = await createClient();
  const { data } = await s
    .from("travel_agents")
    .select("*")
    .eq("lodge_id", lodge)
    .order("entry_date", { ascending: false });
  const rows = (data ?? []) as Array<Record<string, string | null>>;

  return (
    <div>
      <PageHeader
        title="Travel agents"
        description="Agencies that visited the lodge."
      />
      <LodgePicker lodges={lodges} lodge={lodge} />

      <form
        action={addAgent}
        className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4"
      >
        <input type="hidden" name="lodge_id" value={lodge} />
        <L label="Agency name">
          <input required name="agency" className={inp} />
        </L>
        <L label="Contact">
          <input name="contact" placeholder="Phone / email" className={inp} />
        </L>
        <L label="Visit date">
          <input type="date" name="entry_date" className={inp} />
        </L>
        <div className="flex items-end">
          <button className={btn}>Add agent</button>
        </div>
      </form>

      <DataTable
        columns={[
          { key: "agency", label: "Agency" },
          { key: "contact", label: "Contact" },
          { key: "date", label: "Visit date" },
          { key: "act", label: "", className: "text-right" },
        ]}
        rows={rows.map((r) => ({
          agency: r.agency,
          contact: r.contact ?? "—",
          date: r.entry_date ?? "—",
          act: (
            <form action={deleteAgent} className="inline">
              <input type="hidden" name="id" value={String(r.id)} />
              <input type="hidden" name="lodge_id" value={lodge} />
              <button className="text-xs text-error hover:underline">
                Delete
              </button>
            </form>
          ),
        }))}
        empty="No travel agents recorded yet."
      />
    </div>
  );
}
