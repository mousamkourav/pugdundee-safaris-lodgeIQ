import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { DataTable } from "@/components/data-table";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L } from "@/components/form-bits";
import {
  addSafari,
  addTicket,
  addGuestExp,
  saveAccounts,
  addSimpleStock,
  deleteRow,
} from "./actions";

function Del({
  table,
  id,
  lodge,
  month,
}: {
  table: string;
  id: string;
  lodge: string;
  month: string;
}) {
  return (
    <form action={deleteRow} className="inline">
      <input type="hidden" name="table" value={table} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lodge_id" value={lodge} />
      <input type="hidden" name="month" value={month} />
      <button className="text-xs text-error hover:underline">Delete</button>
    </form>
  );
}
function Check({ name, label }: { name: string; label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-sand-700">
      <input type="checkbox" name={name} /> {label}
    </label>
  );
}

export default async function OperationsLogPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Operations log" />;

  const { start, end, label } = monthRange(month);
  const s = await createClient();
  const inM = (t: string, d: string) =>
    s.from(t).select("*").eq("lodge_id", lodge).gte(d, start).lt(d, end).order(d, { ascending: false });

  const [safari, tickets, guest, acct, simple] = await Promise.all([
    inM("safari_usage", "entry_date"),
    inM("ticket_usage", "entry_date"),
    inM("guest_experiences", "entry_date"),
    s.from("accounts_status").select("*").eq("lodge_id", lodge).eq("month", start).maybeSingle(),
    s.from("simple_stock").select("*").eq("lodge_id", lodge).eq("month", start).order("item"),
  ]);

  const safariRows = (safari.data ?? []) as Array<Record<string, number | string>>;
  const ticketRows = (tickets.data ?? []) as Array<Record<string, number | string>>;
  const guestRows = (guest.data ?? []) as Array<Record<string, boolean | string>>;
  const a = (acct.data ?? {}) as Record<string, boolean | string>;
  const simpleRows = (simple.data ?? []) as Array<Record<string, number | string>>;

  return (
    <div>
      <PageHeader
        title="Operations log"
        description={`Safari, tickets, guest experiences, accounts & stock for ${label}.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      {/* SAFARI */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Gypsy / safari usage</h2>
        <form action={addSafari} className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4 lg:grid-cols-8">
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Date"><input required type="date" name="entry_date" className={inp} /></L>
          <L label="Our turn"><input type="number" name="our_turn" defaultValue={0} className={inp} /></L>
          <L label="Vs waiting"><input type="number" name="against_waiting" defaultValue={0} className={inp} /></L>
          <L label="Union gypsy"><input type="number" name="union_gypsy" defaultValue={0} className={inp} /></L>
          <L label="Total safaris"><input type="number" name="total_safaris" defaultValue={0} className={inp} /></L>
          <L label="Full day"><input type="number" name="full_day" defaultValue={0} className={inp} /></L>
          <L label="Pickup/drop"><input type="number" name="outside_pickup_drop" defaultValue={0} className={inp} /></L>
          <div className="flex items-end"><button className={btn}>Add</button></div>
        </form>
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "our", label: "Our turn" },
            { key: "union", label: "Union" },
            { key: "total", label: "Total" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={safariRows.map((r) => ({
            date: r.entry_date,
            our: r.our_turn,
            union: r.union_gypsy,
            total: r.total_safaris,
            act: <Del table="safari_usage" id={String(r.id)} lodge={lodge} month={month} />,
          }))}
          empty="No safari entries this month."
        />
      </section>

      {/* TICKETS */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Ticket usage</h2>
        <form action={addTicket} className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4 lg:grid-cols-8">
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Date"><input required type="date" name="entry_date" className={inp} /></L>
          <L label="Delhi used"><input type="number" name="delhi_used" defaultValue={0} className={inp} /></L>
          <L label="Gate taken"><input type="number" name="gate_taken" defaultValue={0} className={inp} /></L>
          <L label="Boat"><input type="number" name="boat" defaultValue={0} className={inp} /></L>
          <L label="Total used"><input type="number" name="total_used" defaultValue={0} className={inp} /></L>
          <L label="By guest"><input type="number" name="by_guest" defaultValue={0} className={inp} /></L>
          <L label="Delhi unused"><input type="number" name="delhi_unused" defaultValue={0} className={inp} /></L>
          <div className="flex items-end"><button className={btn}>Add</button></div>
        </form>
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "used", label: "Total used" },
            { key: "guest", label: "By guest" },
            { key: "unused", label: "Delhi unused" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={ticketRows.map((r) => ({
            date: r.entry_date,
            used: r.total_used,
            guest: r.by_guest,
            unused: r.delhi_unused,
            act: <Del table="ticket_usage" id={String(r.id)} lodge={lodge} month={month} />,
          }))}
          empty="No ticket entries this month."
        />
      </section>

      {/* GUEST EXPERIENCES */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Guest experiences</h2>
        <form action={addGuestExp} className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-5">
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Date"><input required type="date" name="entry_date" className={inp} /></L>
          <div className="flex items-end"><Check name="experience_dinners" label="Experience dinner" /></div>
          <div className="flex items-end"><Check name="presentations" label="Presentation" /></div>
          <div className="flex items-end"><Check name="private_dinners" label="Private dinner" /></div>
          <div className="flex items-end"><button className={btn}>Add</button></div>
        </form>
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "exp", label: "Experience" },
            { key: "pres", label: "Presentation" },
            { key: "priv", label: "Private" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={guestRows.map((r) => ({
            date: r.entry_date,
            exp: r.experience_dinners ? "Yes" : "—",
            pres: r.presentations ? "Yes" : "—",
            priv: r.private_dinners ? "Yes" : "—",
            act: <Del table="guest_experiences" id={String(r.id)} lodge={lodge} month={month} />,
          }))}
          empty="No guest experiences this month."
        />
      </section>

      {/* ACCOUNTS STATUS */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Accounts status (Tally) — {label}</h2>
        <form action={saveAccounts} className="grid grid-cols-1 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4">
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <div className="flex items-center">
            <label className="flex items-center gap-2 text-sm text-sand-700">
              <input type="checkbox" name="sales_entered" defaultChecked={Boolean(a.sales_entered)} /> Sales entered
            </label>
          </div>
          <div className="flex items-center">
            <label className="flex items-center gap-2 text-sm text-sand-700">
              <input type="checkbox" name="petty_cash_entered" defaultChecked={Boolean(a.petty_cash_entered)} /> Petty cash entered
            </label>
          </div>
          <div className="flex items-center">
            <label className="flex items-center gap-2 text-sm text-sand-700">
              <input type="checkbox" name="expenses_entered" defaultChecked={Boolean(a.expenses_entered)} /> Expenses entered
            </label>
          </div>
          <div className="flex items-end"><button className={btn}>Save status</button></div>
        </form>
      </section>

      {/* SIMPLE STOCK */}
      <section>
        <h2 className="mb-3 text-lg">Stock count (e.g. steel bottles) — {label}</h2>
        <form action={addSimpleStock} className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-5">
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Item"><input required name="item" placeholder="Steel bottles" className={inp} /></L>
          <L label="Opening"><input type="number" name="opening" defaultValue={0} className={inp} /></L>
          <L label="Used"><input type="number" name="used" defaultValue={0} className={inp} /></L>
          <L label="Closing"><input type="number" name="closing" defaultValue={0} className={inp} /></L>
          <div className="flex items-end"><button className={btn}>Add</button></div>
        </form>
        <DataTable
          columns={[
            { key: "item", label: "Item" },
            { key: "opening", label: "Opening" },
            { key: "used", label: "Used" },
            { key: "closing", label: "Closing" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={simpleRows.map((r) => ({
            item: r.item,
            opening: r.opening,
            used: r.used,
            closing: r.closing,
            act: <Del table="simple_stock" id={String(r.id)} lodge={lodge} month={month} />,
          }))}
          empty="No stock counts this month."
        />
      </section>
    </div>
  );
}
