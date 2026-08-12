"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { monthRange } from "@/lib/format";

function num(v: FormDataEntryValue | null): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
function back(lodge: string, month: string) {
  revalidatePath("/staff");
  redirect(`/staff?lodge=${lodge}&month=${month}`);
}

export async function addStaff(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("staff").insert({
    lodge_id,
    full_name: String(fd.get("full_name")),
    role_title: String(fd.get("role_title") ?? "") || null,
    phone: String(fd.get("phone") ?? "") || null,
    join_date: String(fd.get("join_date") || "") || null,
    monthly_ctc: num(fd.get("monthly_ctc")),
  });
  back(lodge_id, month);
}

export async function markStaffLeft(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s
    .from("staff")
    .update({
      status: "left",
      leave_date: String(fd.get("leave_date") || "") || null,
      leave_reason: String(fd.get("leave_reason") ?? "") || null,
    })
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function deleteStaff(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s.from("staff").delete().eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function addAttendance(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("staff_attendance").upsert(
    {
      lodge_id,
      staff_id: String(fd.get("staff_id")),
      date: String(fd.get("date")),
      status: String(fd.get("status")),
      hours: fd.get("hours") ? Number(fd.get("hours")) : null,
    },
    { onConflict: "staff_id,date" }
  );
  back(lodge_id, month);
}

export async function deleteAttendance(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s
    .from("staff_attendance")
    .delete()
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function addAdvance(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const s = await createClient();
  await s.from("staff_advances").insert({
    lodge_id,
    staff_id: String(fd.get("staff_id")),
    amount: num(fd.get("amount")),
    advance_date: String(fd.get("advance_date")),
    reason: String(fd.get("reason") ?? "") || null,
  });
  back(lodge_id, month);
}

export async function deleteAdvance(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s
    .from("staff_advances")
    .delete()
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function generatePayroll(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const lodge_id = String(fd.get("lodge_id"));
  const month = String(fd.get("month"));
  const { start, end } = monthRange(month);
  const s = await createClient();

  const { data: staff } = await s
    .from("staff")
    .select("id,monthly_ctc")
    .eq("lodge_id", lodge_id)
    .eq("status", "active");
  const { data: att } = await s
    .from("staff_attendance")
    .select("staff_id,status")
    .eq("lodge_id", lodge_id)
    .gte("date", start)
    .lt("date", end);

  const attList = (att ?? []) as Array<{ staff_id: string; status: string }>;
  for (const st of (staff ?? []) as Array<{ id: string; monthly_ctc: number }>) {
    const mine = attList.filter((a) => a.staff_id === st.id);
    const present =
      mine.filter((a) => a.status === "present").length +
      mine.filter((a) => a.status === "half_day").length * 0.5;
    const paid = mine.filter((a) => a.status === "paid_leave").length;
    const unpaid = mine.filter((a) => a.status === "unpaid_leave").length;

    const { data: existing } = await s
      .from("payroll")
      .select("overtime_amount,allowances,deductions,advance_deducted,paid")
      .eq("staff_id", st.id)
      .eq("month", start)
      .maybeSingle();

    await s.from("payroll").upsert(
      {
        lodge_id,
        staff_id: st.id,
        month: start,
        base_salary: st.monthly_ctc ?? 0,
        present_days: present,
        paid_leave_days: paid,
        unpaid_leave_days: unpaid,
        overtime_amount: existing?.overtime_amount ?? 0,
        allowances: existing?.allowances ?? 0,
        deductions: existing?.deductions ?? 0,
        advance_deducted: existing?.advance_deducted ?? 0,
        paid: existing?.paid ?? false,
      },
      { onConflict: "staff_id,month" }
    );
  }
  back(lodge_id, month);
}

export async function savePayroll(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const s = await createClient();
  await s
    .from("payroll")
    .update({
      overtime_amount: num(fd.get("overtime_amount")),
      allowances: num(fd.get("allowances")),
      deductions: num(fd.get("deductions")),
      advance_deducted: num(fd.get("advance_deducted")),
    })
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}

export async function togglePaid(fd: FormData) {
  const cu = await getCurrentUser();
  if (!cu?.user) throw new Error("Not authorized");
  const paidNow = String(fd.get("paid")) === "true";
  const s = await createClient();
  await s
    .from("payroll")
    .update({
      paid: !paidNow,
      paid_on: !paidNow ? new Date().toISOString().slice(0, 10) : null,
    })
    .eq("id", String(fd.get("id")));
  back(String(fd.get("lodge_id")), String(fd.get("month")));
}
