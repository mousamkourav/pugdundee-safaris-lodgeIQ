"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { rupees } from "@/lib/sales/format";
import {
  byLine,
  KIND_LABEL,
  MODE_LABEL,
  money,
  nextDue,
  PAYMENT_MODES,
  status,
  STATUS_TEXT,
  STATUS_TONE,
  type Booking,
  type BookingDue,
  type BookingLine,
  type BookingPayment,
  type PaymentKind,
  type PaymentMode,
} from "@/lib/sales/payments/money";
import {
  addPayment,
  attachmentUpload,
  deleteBooking,
  removeDue,
  removeLine,
  removePayment,
  saveBooking,
  saveDue,
  saveLine,
  updatePayment,
  type LineInput,
} from "@/app/(dashboard)/sales/payments/actions";

const dmy = (d: string | null) => (d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : "-");
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export interface AuditRow {
  id: number;
  table_name: string;
  action: string;
  reason: string | null;
  actor: string | null;
  at: string;
  summary: string;
}

// A small form block that needs a reason when it changes something saved.
function ReasonField({ value, onChange, label = "Reason for the change" }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <label className="block">
      <span className={ui.label}>{label}</span>
      <input className={ui.inputSm} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. amount typed wrong" maxLength={500} />
    </label>
  );
}

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ error?: string } | undefined>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r?.error) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  return { pending, error, run, setError };
}

// ---------------------------------------------------------------- payment form
function PaymentForm({ booking, lines, edit, onDone }: { booking: Booking; lines: BookingLine[]; edit?: BookingPayment; onDone: () => void }) {
  const { pending, error, run, setError } = useRun();
  const [kind, setKind] = useState<PaymentKind>(edit?.kind ?? "payment");
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [date, setDate] = useState(edit?.paid_on ?? istToday());
  const [mode, setMode] = useState<PaymentMode>(edit?.mode ?? "bank_transfer");
  const [lineId, setLineId] = useState(edit?.line_id ?? "");
  const [reference, setReference] = useState(edit?.reference ?? "");
  const [receivedBy, setReceivedBy] = useState(edit?.received_by ?? "");
  const [note, setNote] = useState(edit?.note ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");

  const submit = () =>
    run(async () => {
      let attachment_path: string | null | undefined = undefined;
      if (file) {
        const up = await attachmentUpload(booking.id, file.name, file.type, file.size);
        if (up.error || !up.path || !up.token) return { error: up.error ?? "Could not upload the file." };
        const { error: e } = await createClient().storage.from("sales-payments").uploadToSignedUrl(up.path, up.token, file, { contentType: file.type });
        if (e) return { error: `The file could not be uploaded: ${e.message}` };
        attachment_path = up.path;
      }
      const input = { booking_id: booking.id, line_id: lineId || null, kind, amount, paid_on: date, mode, reference, received_by: receivedBy, note, ...(attachment_path !== undefined ? { attachment_path } : {}) };
      return edit ? updatePayment(edit.id, input, reason) : addPayment(input);
    }, onDone);

  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-sand-200 bg-sand-50 p-3 md:grid-cols-4">
      <label>
        <span className={ui.label}>Type</span>
        <select className={`${ui.select} w-full !py-2`} value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
          {(Object.keys(KIND_LABEL) as PaymentKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
      </label>
      <label>
        <span className={ui.label}>Amount (Rs)</span>
        <input className={ui.inputSm} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 70500" />
      </label>
      <label>
        <span className={ui.label}>Date</span>
        <input type="date" className={ui.inputSm} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        <span className={ui.label}>How</span>
        <select className={`${ui.select} w-full !py-2`} value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)}>
          {PAYMENT_MODES.map((m) => (
            <option key={m} value={m}>{MODE_LABEL[m]}</option>
          ))}
        </select>
      </label>
      {lines.length > 1 && (
        <label className="col-span-2">
          <span className={ui.label}>For</span>
          <select className={`${ui.select} w-full !py-2`} value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">The whole booking</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>{[l.lodge_name, l.booking_no].filter(Boolean).join(" - ") || "Lodge booking"}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className={ui.label}>Reference</span>
        <input className={ui.inputSm} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / transaction no." maxLength={200} />
      </label>
      <label>
        <span className={ui.label}>Received by</span>
        <input className={ui.inputSm} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="e.g. Accounts" maxLength={120} />
      </label>
      <label className="col-span-2">
        <span className={ui.label}>Note</span>
        <input className={ui.inputSm} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </label>
      <label className="col-span-2">
        <span className={ui.label}>Receipt (optional, photo or PDF, up to 5 MB)</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block w-full text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {edit && (
        <div className="col-span-2 md:col-span-4">
          <ReasonField value={reason} onChange={setReason} />
        </div>
      )}
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-4">
        <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={pending} onClick={submit}>
          {pending ? "Saving..." : edit ? "Save the change" : "Add"}
        </button>
        <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} onClick={() => { setError(null); onDone(); }}>
          Cancel
        </button>
        {error && <span className="text-sm text-error">{error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- a "remove with a reason" button
function RemoveButton({ label = "Remove", onRemove }: { label?: string; onRemove: (reason: string) => Promise<{ error?: string } | undefined> }) {
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open)
    return (
      <button type="button" className="text-xs font-medium text-error hover:underline" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input className={`${ui.inputSm} !w-48`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why?" maxLength={500} />
      <button type="button" className={`${ui.btnDangerOutline} ${ui.btnSm}`} disabled={pending} onClick={() => run(() => onRemove(reason), () => setOpen(false))}>
        {pending ? "..." : label}
      </button>
      <button type="button" className="text-xs text-sand-500" onClick={() => setOpen(false)}>Keep</button>
      {error && <span className="text-xs text-error">{error}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- lodge line form
function LineForm({ bookingId, line, onDone }: { bookingId: string; line?: BookingLine; onDone: () => void }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState<LineInput>({
    lodge_name: line?.lodge_name ?? "",
    booking_no: line?.booking_no ?? "",
    check_in: line?.check_in ?? "",
    check_out: line?.check_out ?? "",
    rooms: line ? String(line.rooms) : "1",
    nights: line ? String(line.nights) : "",
    room_amount: line ? String(line.room_amount) : "",
    safari_amount: line ? String(line.safari_amount) : "",
    transfer_amount: line ? String(line.transfer_amount) : "",
    other_amount: line ? String(line.other_amount) : "",
  });
  const [reason, setReason] = useState("");
  const set = (k: keyof LineInput) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  const field = (k: keyof LineInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label>
      <span className={ui.label}>{label}</span>
      <input className={ui.inputSm} value={String(v[k] ?? "")} onChange={set(k)} {...props} />
    </label>
  );
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-sand-200 bg-sand-50 p-3 md:grid-cols-5">
      {field("lodge_name", "Lodge / hotel", { maxLength: 200 })}
      {field("booking_no", "Djubo booking no.", { maxLength: 40, placeholder: "e.g. KIN0005709" })}
      {field("check_in", "Check in", { type: "date" })}
      {field("check_out", "Check out", { type: "date" })}
      {field("rooms", "Rooms", { inputMode: "numeric" })}
      {field("nights", "Nights", { inputMode: "numeric" })}
      {field("room_amount", "Rooms Rs (incl. GST)", { inputMode: "decimal" })}
      {field("safari_amount", "Safaris Rs", { inputMode: "decimal" })}
      {field("transfer_amount", "Transfers Rs", { inputMode: "decimal" })}
      {field("other_amount", "Other Rs", { inputMode: "decimal" })}
      {line && (
        <div className="col-span-2 md:col-span-5">
          <ReasonField value={reason} onChange={setReason} />
        </div>
      )}
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-5">
        <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={pending} onClick={() => run(() => saveLine(bookingId, line?.id ?? null, v, reason), onDone)}>
          {pending ? "Saving..." : line ? "Save the change" : "Add lodge booking"}
        </button>
        <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} onClick={onDone}>Cancel</button>
        {error && <span className="text-sm text-error">{error}</span>}
      </div>
    </div>
  );
}

function DueForm({ bookingId, due, onDone }: { bookingId: string; due?: BookingDue; onDone: () => void }) {
  const { pending, error, run } = useRun();
  const [label, setLabel] = useState(due?.label ?? "Balance");
  const [date, setDate] = useState(due?.due_on ?? "");
  const [amount, setAmount] = useState(due ? String(due.amount) : "");
  const [reason, setReason] = useState("");
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-sand-200 bg-sand-50 p-3 md:grid-cols-4">
      <label>
        <span className={ui.label}>What</span>
        <input className={ui.inputSm} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
      </label>
      <label>
        <span className={ui.label}>Due on</span>
        <input type="date" className={ui.inputSm} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label>
        <span className={ui.label}>Amount (Rs)</span>
        <input className={ui.inputSm} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </label>
      {due && <ReasonField value={reason} onChange={setReason} />}
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-4">
        <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={pending} onClick={() => run(() => saveDue(bookingId, due?.id ?? null, { label, due_on: date, amount }, reason), onDone)}>
          {pending ? "Saving..." : due ? "Save the change" : "Add due date"}
        </button>
        <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} onClick={onDone}>Cancel</button>
        {error && <span className="text-sm text-error">{error}</span>}
      </div>
    </div>
  );
}

function BookingForm({ booking, onDone }: { booking: Booking; onDone: () => void }) {
  const { pending, error, run } = useRun();
  const [v, setV] = useState({
    guest_name: booking.guest_name,
    check_in: booking.check_in ?? "",
    check_out: booking.check_out ?? "",
    other_amount: String(booking.other_amount),
    discount_amount: String(booking.discount_amount),
    notes: booking.notes ?? "",
    cancelled: booking.cancelled,
  });
  const [reason, setReason] = useState("");
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-sand-200 bg-sand-50 p-3 md:grid-cols-3">
      <label className="col-span-2 md:col-span-1">
        <span className={ui.label}>Guest</span>
        <input className={ui.inputSm} value={v.guest_name} onChange={(e) => setV({ ...v, guest_name: e.target.value })} maxLength={200} />
      </label>
      <label>
        <span className={ui.label}>Arrival</span>
        <input type="date" className={ui.inputSm} value={v.check_in} onChange={(e) => setV({ ...v, check_in: e.target.value })} />
      </label>
      <label>
        <span className={ui.label}>Departure</span>
        <input type="date" className={ui.inputSm} value={v.check_out} onChange={(e) => setV({ ...v, check_out: e.target.value })} />
      </label>
      <label>
        <span className={ui.label}>Other on the booking (Rs)</span>
        <input className={ui.inputSm} inputMode="decimal" value={v.other_amount} onChange={(e) => setV({ ...v, other_amount: e.target.value })} />
        <span className="mt-1 block text-[11px] text-sand-500">Markup, flights, city items: not on a lodge.</span>
      </label>
      <label>
        <span className={ui.label}>Discount on the booking (Rs)</span>
        <input className={ui.inputSm} inputMode="decimal" value={v.discount_amount} onChange={(e) => setV({ ...v, discount_amount: e.target.value })} />
      </label>
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" checked={v.cancelled} onChange={(e) => setV({ ...v, cancelled: e.target.checked })} />
        Cancelled (owes only its cancellation charges)
      </label>
      <label className="col-span-2 md:col-span-3">
        <span className={ui.label}>Notes</span>
        <textarea className={ui.inputSm} rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={2000} />
      </label>
      <div className="col-span-2 md:col-span-3">
        <ReasonField value={reason} onChange={setReason} />
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-3">
        <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={pending} onClick={() => run(() => saveBooking(booking.id, v, reason), onDone)}>
          {pending ? "Saving..." : "Save the change"}
        </button>
        <button type="button" className={`${ui.btnGhost} ${ui.btnSm}`} onClick={onDone}>Cancel</button>
        {error && <span className="text-sm text-error">{error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the page
export function BookingView({
  booking,
  removed,
  audit,
  ownerName,
  admin,
  today,
}: {
  booking: Booking;
  removed: (BookingPayment & { change_reason: string | null })[];
  audit: AuditRow[];
  ownerName: string | null;
  admin: boolean;
  today: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<string | null>(null); // which form is open
  const lines = [...booking.lines].sort((a, b) => a.sort - b.sort);
  const m = money(booking);
  const st = status(booking, today);
  const nd = nextDue(booking);
  const share = byLine(booking);
  const lineName = (id: string | null) => {
    const l = lines.find((x) => x.id === id);
    return l ? [l.lodge_name, l.booking_no].filter(Boolean).join(" - ") : "Whole booking";
  };
  const pays = [...booking.payments].sort((a, b) => (a.paid_on ?? "").localeCompare(b.paid_on ?? ""));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className={`${ui.card} p-4`}>
          <p className="eyebrow">Status</p>
          <p className="mt-2"><Badge tone={STATUS_TONE[st]} dot>{STATUS_TEXT[st]}</Badge></p>
          {nd && <p className="mt-1 text-xs text-sand-500">Next: {rupees(nd.amount)} on {dmy(nd.due_on)}</p>}
        </div>
        <div className={`${ui.card} p-4`}>
          <p className="eyebrow">{booking.cancelled ? "Owed (charges)" : "Total"}</p>
          <p className="tabular mt-1 font-display text-2xl font-semibold text-olive-800">{rupees(m.owed)}</p>
          {booking.cancelled && <p className="mt-1 text-xs text-sand-500">Trip value was {rupees(m.total)}</p>}
        </div>
        <div className={`${ui.card} p-4`}>
          <p className="eyebrow">Received</p>
          <p className="tabular mt-1 font-display text-2xl font-semibold text-success">{rupees(m.received)}</p>
          {m.refunded > 0 && <p className="mt-1 text-xs text-sand-500">Refunded {rupees(m.refunded)}</p>}
        </div>
        <div className="rounded-xl border border-gold-200 bg-gold-50 p-4 shadow-card">
          <p className="eyebrow !text-gold-800">Balance</p>
          <p className={`tabular mt-1 font-display text-2xl font-semibold ${m.balance < 0 ? "text-error" : "text-olive-800"}`}>{rupees(m.balance)}</p>
        </div>
        <div className={`${ui.card} col-span-2 p-4 lg:col-span-1`}>
          <p className="eyebrow">Salesperson</p>
          <p className="mt-1 text-sm font-medium text-olive-800">{ownerName ?? "-"}</p>
          <p className="mt-1 text-xs text-sand-500">{booking.source === "quote" ? `From quote${booking.version_no ? ` (version ${booking.version_no})` : ""}` : booking.source === "import" ? "Imported from Excel" : "Added by hand"}</p>
        </div>
      </div>
      {m.warning && <p className={ui.alertWarning}>{m.warning.replace(/(\d+(?:\.\d+)?)$/, (x) => rupees(Number(x)))}</p>}

      {/* payments */}
      <section className={`${ui.card} p-4`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Payments</h2>
          {form !== "pay" && (
            <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} onClick={() => setForm("pay")}>
              <Icon name="plus" className="h-4 w-4" />
              Add payment
            </button>
          )}
        </div>
        {form === "pay" && <div className="mb-3"><PaymentForm booking={booking} lines={lines} onDone={() => setForm(null)} /></div>}
        {pays.length === 0 ? (
          <p className="text-sm text-sand-500">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-sand-200">
            {pays.map((p) => (
              <li key={p.id} className="py-2.5">
                {form === `pay:${p.id}` ? (
                  <PaymentForm booking={booking} lines={lines} edit={p} onDone={() => setForm(null)} />
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                    <span className="tabular w-24 text-sand-600">{p.paid_on ? dmy(p.paid_on) : "No date"}</span>
                    <span className={`tabular w-28 text-right font-semibold ${p.kind === "payment" ? "text-success" : p.kind === "refund" ? "text-error" : "text-warning"}`}>
                      {p.kind === "payment" ? "" : "- "}{rupees(p.amount)}
                    </span>
                    <span className="text-sand-700">{p.kind === "payment" ? MODE_LABEL[p.mode] : KIND_LABEL[p.kind]}</span>
                    {lines.length > 1 && <span className="text-xs text-sand-500">{lineName(p.line_id)}</span>}
                    {p.reference && <span className="text-xs text-sand-500">Ref {p.reference}</span>}
                    {p.received_by && <span className="text-xs text-sand-500">by {p.received_by}</span>}
                    {p.note && <span className="text-xs text-sand-500">{p.note}</span>}
                    {p.attachment_path && <a href={`/api/sales/payments/attachment?p=${p.id}`} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-olive-600 underline">Receipt</a>}
                    <span className="ml-auto flex items-center gap-3">
                      <button type="button" className="text-xs font-medium text-olive-600 hover:underline" onClick={() => setForm(`pay:${p.id}`)}>Edit</button>
                      <RemoveButton onRemove={(r) => removePayment(p.id, booking.id, r)} />
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {removed.length > 0 && (
          <details className="mt-3 text-xs text-sand-500">
            <summary className="cursor-pointer">Removed entries ({removed.length})</summary>
            <ul className="mt-2 space-y-1">
              {removed.map((p) => (
                <li key={p.id} className="line-through">
                  {dmy(p.paid_on)} {KIND_LABEL[p.kind]} {rupees(p.amount)} <span className="no-underline">({p.change_reason ?? "no reason"})</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* lodge bookings */}
      <section className={`${ui.card} p-4`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Lodge bookings</h2>
          {form !== "line" && <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setForm("line")}>Add lodge booking</button>}
        </div>
        {form === "line" && <div className="mb-3"><LineForm bookingId={booking.id} onDone={() => setForm(null)} /></div>}
        {lines.length === 0 ? (
          <p className="text-sm text-sand-500">No lodge bookings. Add one with its Djubo booking number.</p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => {
              const sh = share.get(l.id)!;
              return form === `line:${l.id}` ? (
                <LineForm key={l.id} bookingId={booking.id} line={l} onDone={() => setForm(null)} />
              ) : (
                <div key={l.id} className="rounded-lg border border-sand-200 p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium text-olive-800">{l.lodge_name || "Lodge"}</span>
                    <span className="text-xs text-sand-500">{l.booking_no || "No Djubo no. yet"}</span>
                    <span className="tabular text-xs text-sand-600">{dmy(l.check_in)} to {dmy(l.check_out)}, {l.rooms} room{l.rooms === 1 ? "" : "s"}, {l.nights} night{l.nights === 1 ? "" : "s"}</span>
                    <span className="ml-auto flex items-center gap-3">
                      <button type="button" className="text-xs font-medium text-olive-600 hover:underline" onClick={() => setForm(`line:${l.id}`)}>Edit</button>
                      <RemoveButton onRemove={(r) => removeLine(booking.id, l.id, r)} />
                    </span>
                  </div>
                  <div className="tabular mt-1 flex flex-wrap gap-x-4 text-xs text-sand-600">
                    <span>Rooms {rupees(l.room_amount)}</span>
                    <span>Safaris {rupees(l.safari_amount)}</span>
                    <span>Transfers {rupees(l.transfer_amount)}</span>
                    {l.other_amount > 0 && <span>Other {rupees(l.other_amount)}</span>}
                    <span className="font-semibold text-sand-700">Total {rupees(sh.total)}</span>
                    <span>Paid {rupees(sh.paid)}</span>
                    <span className="font-semibold text-sand-700">Balance {rupees(sh.balance)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {(booking.other_amount > 0 || booking.discount_amount > 0) && (
          <p className="tabular mt-3 text-xs text-sand-600">
            On the booking itself: {booking.other_amount > 0 && <>other {rupees(booking.other_amount)} </>}
            {booking.discount_amount > 0 && <>discount {rupees(booking.discount_amount)}</>}
          </p>
        )}
      </section>

      {/* dues */}
      <section className={`${ui.card} p-4`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Due dates</h2>
          {form !== "due" && <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setForm("due")}>Add due date</button>}
        </div>
        {form === "due" && <div className="mb-3"><DueForm bookingId={booking.id} onDone={() => setForm(null)} /></div>}
        {booking.dues.length === 0 ? (
          <p className="text-sm text-sand-500">No due dates. Add them so the booking shows Due soon / Overdue.</p>
        ) : (
          <ul className="divide-y divide-sand-200">
            {[...booking.dues].sort((a, b) => a.due_on.localeCompare(b.due_on)).map((d) =>
              form === `due:${d.id}` ? (
                <li key={d.id} className="py-2"><DueForm bookingId={booking.id} due={d} onDone={() => setForm(null)} /></li>
              ) : (
                <li key={d.id} className="flex flex-wrap items-baseline gap-x-4 py-2 text-sm">
                  <span className="tabular w-24 text-sand-600">{dmy(d.due_on)}</span>
                  <span className="tabular w-28 text-right font-semibold">{rupees(d.amount)}</span>
                  <span className="text-sand-700">{d.label}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <button type="button" className="text-xs font-medium text-olive-600 hover:underline" onClick={() => setForm(`due:${d.id}`)}>Edit</button>
                    <RemoveButton onRemove={(r) => removeDue(booking.id, d.id, r)} />
                  </span>
                </li>
              )
            )}
          </ul>
        )}
      </section>

      {/* the booking */}
      <section className={`${ui.card} p-4`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg">Booking details</h2>
          {form !== "booking" && <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => setForm("booking")}>Edit</button>}
        </div>
        {form === "booking" ? (
          <BookingForm booking={booking} onDone={() => setForm(null)} />
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <div><dt className="text-xs text-sand-500">Guest</dt><dd className="font-medium">{booking.guest_name}</dd></div>
            <div><dt className="text-xs text-sand-500">Arrival - departure</dt><dd className="tabular">{dmy(booking.check_in)} - {dmy(booking.check_out)}</dd></div>
            <div><dt className="text-xs text-sand-500">Currency of the quote</dt><dd>{booking.currency} (amounts here in Rs)</dd></div>
            <div><dt className="text-xs text-sand-500">Cancelled</dt><dd>{booking.cancelled ? `Yes${booking.cancelled_on ? `, ${dmy(booking.cancelled_on)}` : ""}` : "No"}</dd></div>
            {booking.notes && <div className="col-span-2 md:col-span-4"><dt className="text-xs text-sand-500">Notes</dt><dd className="whitespace-pre-line">{booking.notes}</dd></div>}
          </dl>
        )}
        {admin && (
          <div className="mt-4 border-t border-sand-200 pt-3">
            <RemoveButton label="Delete this booking" onRemove={async (r) => {
              const res = await deleteBooking(booking.id, r);
              if (!res.error) router.push("/sales/payments");
              return res;
            }} />
          </div>
        )}
      </section>

      {/* history */}
      <section className={`${ui.card} p-4`}>
        <h2 className="mb-2 text-lg">History</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-sand-500">No changes yet.</p>
        ) : (
          <ul className="space-y-1.5 text-xs text-sand-600">
            {audit.map((a) => (
              <li key={a.id}>
                <span className="tabular text-sand-500">{new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })}</span>{" "}
                {a.summary}
                {a.reason && <span className="text-sand-500"> - {a.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
