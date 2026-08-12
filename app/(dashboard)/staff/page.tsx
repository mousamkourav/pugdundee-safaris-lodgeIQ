import { requireUser } from "@/lib/auth";
import { getAccessibleLodges, resolveLodge } from "@/lib/lodges";
import { currentMonth, monthRange, inr } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DataTable } from "@/components/data-table";
import { LodgeMonthPicker } from "@/components/lodge-month-picker";
import { NoLodge } from "@/components/no-lodge";
import { inp, btn, L, labelize } from "@/components/form-bits";
import {
  addStaff,
  markStaffLeft,
  deleteStaff,
  addAttendance,
  deleteAttendance,
  addAdvance,
  deleteAdvance,
  generatePayroll,
  savePayroll,
  togglePaid,
} from "./actions";

const ATT_STATUS = [
  "present",
  "absent",
  "paid_leave",
  "unpaid_leave",
  "half_day",
  "week_off",
];

type Staff = {
  id: string;
  full_name: string;
  role_title: string | null;
  status: string;
  monthly_ctc: number | null;
  leave_reason: string | null;
};

function Del({
  action,
  id,
  lodge,
  month,
  label = "Delete",
}: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  lodge: string;
  month: string;
  label?: string;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lodge_id" value={lodge} />
      <input type="hidden" name="month" value={month} />
      <button className="text-xs text-error hover:underline">{label}</button>
    </form>
  );
}

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ lodge?: string; month?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const lodges = await getAccessibleLodges();
  const lodge = resolveLodge(sp.lodge, lodges);
  const month = sp.month || currentMonth();
  if (!lodge) return <NoLodge title="Staff & payroll" />;

  const { start, end, label } = monthRange(month);
  const s = await createClient();

  const { data: staffData } = await s
    .from("staff")
    .select("*")
    .eq("lodge_id", lodge)
    .order("full_name");
  const { data: attData } = await s
    .from("staff_attendance")
    .select("*")
    .eq("lodge_id", lodge)
    .gte("date", start)
    .lt("date", end)
    .order("date", { ascending: false });
  const { data: advData } = await s
    .from("staff_advances")
    .select("*")
    .eq("lodge_id", lodge)
    .order("advance_date", { ascending: false });
  const { data: payData } = await s
    .from("payroll")
    .select("*")
    .eq("lodge_id", lodge)
    .eq("month", start);

  const staff = (staffData ?? []) as Staff[];
  const active = staff.filter((x) => x.status === "active");
  const att = (attData ?? []) as Array<Record<string, string>>;
  const adv = (advData ?? []) as Array<Record<string, number | string>>;
  const pay = (payData ?? []) as Array<Record<string, number | string | boolean>>;

  const staffName = (id: string) =>
    staff.find((x) => x.id === id)?.full_name ?? "—";

  const payrollTotal = pay.reduce((t, p) => t + Number(p.net_payable || 0), 0);

  return (
    <div>
      <PageHeader
        title="Staff & payroll"
        description={`Attendance, advances and payroll for ${label}.`}
      />
      <LodgeMonthPicker lodges={lodges} lodge={lodge} month={month} />

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <KpiCard label="Active staff" value={active.length} />
        <KpiCard label="Payroll rows" value={pay.length} />
        <KpiCard label="Net payable" value={inr(payrollTotal)} />
      </div>

      {/* STAFF */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Staff</h2>
        <form
          action={addStaff}
          className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          <input type="hidden" name="lodge_id" value={lodge} />
          <input type="hidden" name="month" value={month} />
          <L label="Full name">
            <input required name="full_name" className={inp} />
          </L>
          <L label="Role">
            <input name="role_title" placeholder="Naturalist" className={inp} />
          </L>
          <L label="Phone">
            <input name="phone" className={inp} />
          </L>
          <L label="Join date">
            <input type="date" name="join_date" className={inp} />
          </L>
          <L label="Monthly salary (₹)">
            <input type="number" name="monthly_ctc" defaultValue={0} className={inp} />
          </L>
          <div className="flex items-end">
            <button className={btn}>Add staff</button>
          </div>
        </form>
        <DataTable
          columns={[
            { key: "name", label: "Name" },
            { key: "role", label: "Role" },
            { key: "ctc", label: "Salary", className: "tabular" },
            { key: "status", label: "Status" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={staff.map((x) => ({
            name: x.full_name,
            role: x.role_title ?? "—",
            ctc: inr(Number(x.monthly_ctc || 0)),
            status:
              x.status === "left" ? (
                <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs text-sand-600">
                  Left{x.leave_reason ? ` · ${x.leave_reason}` : ""}
                </span>
              ) : (
                <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs text-success">
                  Active
                </span>
              ),
            act: (
              <span className="flex justify-end gap-3">
                {x.status === "active" && (
                  <form action={markStaffLeft} className="inline">
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="lodge_id" value={lodge} />
                    <input type="hidden" name="month" value={month} />
                    <input
                      type="hidden"
                      name="leave_date"
                      value={new Date().toISOString().slice(0, 10)}
                    />
                    <button className="text-xs text-warning hover:underline">
                      Mark left
                    </button>
                  </form>
                )}
                <Del action={deleteStaff} id={x.id} lodge={lodge} month={month} />
              </span>
            ),
          }))}
          empty="No staff added yet."
        />
      </section>

      {/* ATTENDANCE */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Attendance</h2>
        {active.length === 0 ? (
          <p className="text-sm text-sand-500">Add active staff to mark attendance.</p>
        ) : (
          <>
            <form
              action={addAttendance}
              className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4"
            >
              <input type="hidden" name="lodge_id" value={lodge} />
              <input type="hidden" name="month" value={month} />
              <L label="Staff">
                <select name="staff_id" className={inp}>
                  {active.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.full_name}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Date">
                <input required type="date" name="date" className={inp} />
              </L>
              <L label="Status">
                <select name="status" className={inp}>
                  {ATT_STATUS.map((a) => (
                    <option key={a} value={a}>
                      {labelize(a)}
                    </option>
                  ))}
                </select>
              </L>
              <div className="flex items-end">
                <button className={btn}>Mark</button>
              </div>
            </form>
            <DataTable
              columns={[
                { key: "date", label: "Date" },
                { key: "name", label: "Staff" },
                { key: "status", label: "Status" },
                { key: "act", label: "", className: "text-right" },
              ]}
              rows={att.slice(0, 30).map((a) => ({
                date: a.date,
                name: staffName(String(a.staff_id)),
                status: labelize(String(a.status)),
                act: (
                  <Del
                    action={deleteAttendance}
                    id={String(a.id)}
                    lodge={lodge}
                    month={month}
                  />
                ),
              }))}
              empty="No attendance this month yet."
            />
          </>
        )}
      </section>

      {/* ADVANCES */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg">Advances</h2>
        {active.length > 0 && (
          <form
            action={addAdvance}
            className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-sand-200 bg-white p-4 sm:grid-cols-4"
          >
            <input type="hidden" name="lodge_id" value={lodge} />
            <input type="hidden" name="month" value={month} />
            <L label="Staff">
              <select name="staff_id" className={inp}>
                {active.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.full_name}
                  </option>
                ))}
              </select>
            </L>
            <L label="Amount (₹)">
              <input type="number" name="amount" defaultValue={0} className={inp} />
            </L>
            <L label="Date">
              <input required type="date" name="advance_date" className={inp} />
            </L>
            <div className="flex items-end">
              <button className={btn}>Add</button>
            </div>
          </form>
        )}
        <DataTable
          columns={[
            { key: "date", label: "Date" },
            { key: "name", label: "Staff" },
            { key: "amount", label: "Amount", className: "text-right tabular" },
            { key: "act", label: "", className: "text-right" },
          ]}
          rows={adv.slice(0, 20).map((a) => ({
            date: a.advance_date,
            name: staffName(String(a.staff_id)),
            amount: inr(Number(a.amount)),
            act: (
              <Del
                action={deleteAdvance}
                id={String(a.id)}
                lodge={lodge}
                month={month}
              />
            ),
          }))}
          empty="No advances recorded."
        />
      </section>

      {/* PAYROLL */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg">Payroll — {label}</h2>
          <form action={generatePayroll}>
            <input type="hidden" name="lodge_id" value={lodge} />
            <input type="hidden" name="month" value={month} />
            <button className="rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white hover:bg-olive-700">
              Generate / refresh
            </button>
          </form>
        </div>
        <p className="mb-4 text-sm text-sand-500">
          Generate pulls each active staff member&apos;s attendance and base salary.
          Then enter overtime, allowances, deductions and advance recovery per row —
          net pay calculates automatically.
        </p>

        {pay.length === 0 ? (
          <div className="rounded-xl border border-sand-200 bg-white p-6 text-center text-sand-500">
            No payroll yet for this month. Click &quot;Generate / refresh&quot;.
          </div>
        ) : (
          <div className="space-y-3">
            {pay.map((p) => (
              <div
                key={String(p.id)}
                className="rounded-xl border border-sand-200 bg-white p-4"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-sand-800">
                      {staffName(String(p.staff_id))}
                    </p>
                    <p className="text-xs text-sand-500">
                      Base {inr(Number(p.base_salary))} · Present{" "}
                      {String(p.present_days)} · Paid leave{" "}
                      {String(p.paid_leave_days)} · Unpaid{" "}
                      {String(p.unpaid_leave_days)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg text-olive-700 tabular">
                      {inr(Number(p.net_payable))}
                    </span>
                    <form action={togglePaid} className="inline">
                      <input type="hidden" name="id" value={String(p.id)} />
                      <input type="hidden" name="lodge_id" value={lodge} />
                      <input type="hidden" name="month" value={month} />
                      <input
                        type="hidden"
                        name="paid"
                        value={String(p.paid)}
                      />
                      <button
                        className={
                          "rounded-full px-3 py-1 text-xs " +
                          (p.paid
                            ? "bg-success-bg text-success"
                            : "bg-sand-100 text-sand-600 hover:bg-sand-200")
                        }
                      >
                        {p.paid ? "Paid ✓" : "Mark paid"}
                      </button>
                    </form>
                  </div>
                </div>
                <form
                  action={savePayroll}
                  className="grid grid-cols-2 gap-3 sm:grid-cols-5"
                >
                  <input type="hidden" name="id" value={String(p.id)} />
                  <input type="hidden" name="lodge_id" value={lodge} />
                  <input type="hidden" name="month" value={month} />
                  <L label="Overtime (₹)">
                    <input
                      type="number"
                      name="overtime_amount"
                      defaultValue={Number(p.overtime_amount)}
                      className={inp}
                    />
                  </L>
                  <L label="Allowances (₹)">
                    <input
                      type="number"
                      name="allowances"
                      defaultValue={Number(p.allowances)}
                      className={inp}
                    />
                  </L>
                  <L label="Deductions (₹)">
                    <input
                      type="number"
                      name="deductions"
                      defaultValue={Number(p.deductions)}
                      className={inp}
                    />
                  </L>
                  <L label="Advance recovered (₹)">
                    <input
                      type="number"
                      name="advance_deducted"
                      defaultValue={Number(p.advance_deducted)}
                      className={inp}
                    />
                  </L>
                  <div className="flex items-end">
                    <button className={btn}>Save</button>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
