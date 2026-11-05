"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { createBooking, saveLine } from "@/app/(dashboard)/sales/payments/actions";

// A booking made outside LodgeIQ: the guest, and its first lodge booking. More lodges, dues and
// payments are added on its page.
export function NewBooking({ members }: { members: { id: string; name: string }[] | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [v, setV] = useState({ guest_name: "", owner_id: "", lodge_name: "", booking_no: "", check_in: "", check_out: "", rooms: "1", nights: "", room_amount: "", safari_amount: "", transfer_amount: "", other_amount: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const input = (k: keyof typeof v, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>
      <span className={ui.label}>{label}</span>
      <input className={ui.inputSm} value={v[k]} onChange={set(k)} {...props} />
    </label>
  );
  const submit = () =>
    start(async () => {
      setError(null);
      const b = await createBooking({ guest_name: v.guest_name, check_in: v.check_in || null, check_out: v.check_out || null, other_amount: 0, discount_amount: 0, ...(members ? { owner_id: v.owner_id || null } : {}) });
      if (b.error || !b.id) return setError(b.error ?? "Could not save.");
      if (v.lodge_name || v.booking_no || v.room_amount) {
        const l = await saveLine(b.id, null, { ...v, check_in: v.check_in || null, check_out: v.check_out || null }, "Added with the booking");
        if (l.error) return setError(`The booking was saved, but not its lodge booking: ${l.error}`);
      }
      router.push(`/sales/payments/${b.id}`);
    });
  return (
    <div className={`${ui.card} grid grid-cols-2 gap-3 p-4 md:grid-cols-4`}>
      <label className="col-span-2">
        <span className={ui.label}>Guest name</span>
        <input className={ui.inputSm} value={v.guest_name} onChange={set("guest_name")} maxLength={200} />
      </label>
      {members && (
        <label className="col-span-2">
          <span className={ui.label}>Salesperson</span>
          <select className={`${ui.select} w-full !py-2`} value={v.owner_id} onChange={set("owner_id")}>
            <option value="">None</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
      )}
      {input("lodge_name", "Lodge / hotel", { maxLength: 200 })}
      {input("booking_no", "Djubo booking no.", { maxLength: 40, placeholder: "e.g. KIN0005709" })}
      {input("check_in", "Check in", { type: "date" })}
      {input("check_out", "Check out", { type: "date" })}
      {input("rooms", "Rooms", { inputMode: "numeric" })}
      {input("nights", "Nights", { inputMode: "numeric" })}
      {input("room_amount", "Rooms Rs (incl. GST)", { inputMode: "decimal" })}
      {input("safari_amount", "Safaris Rs", { inputMode: "decimal" })}
      {input("transfer_amount", "Transfers Rs", { inputMode: "decimal" })}
      {input("other_amount", "Other Rs", { inputMode: "decimal" })}
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-4">
        <button type="button" className={ui.btnPrimary} disabled={pending} onClick={submit}>{pending ? "Saving..." : "Save booking"}</button>
        {error && <span className="text-sm text-error">{error}</span>}
      </div>
    </div>
  );
}
