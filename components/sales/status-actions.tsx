"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { rupees } from "@/lib/sales/format";
import { changeStatus, reassignQuery, type StatusInput } from "@/app/(dashboard)/sales/queries/[id]/actions";
import type { QueryStatus } from "@/lib/sales/status";

type Dialog = "booked" | "lost" | "cancelled" | "open" | "reassign" | null;

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-olive-800/35 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-xl bg-white shadow-overlay" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-sand-200 px-5 py-4">
          <div>
            <h2 className="text-lg">{title}</h2>
            {subtitle && <p className="text-sm text-sand-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-sand-500 hover:bg-sand-100" aria-label="Close">
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatusActions({
  queryId,
  queryNo,
  status,
  isAdmin,
  canAct,
  reasons,
  members,
  assignedTo,
  deposit,
  today,
}: {
  queryId: string;
  queryNo: string;
  status: QueryStatus;
  isAdmin: boolean;
  canAct: boolean; // assigned member or admin
  reasons: { lost: string[]; cancelled: string[] };
  members: { id: string; name: string }[];
  assignedTo: string | null;
  deposit: number | null;
  today: string;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [amount, setAmount] = useState(deposit ? String(deposit) : "");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [reason, setReason] = useState("");
  const [remark, setRemark] = useState("");
  const [cancelCharge, setCancelCharge] = useState("");
  const [refund, setRefund] = useState("");
  const [member, setMember] = useState(assignedTo ?? "");

  function open(d: Dialog) {
    setError(null);
    setReason(d === "lost" ? reasons.lost[0] ?? "" : d === "cancelled" ? reasons.cancelled[0] ?? "" : "");
    setRemark("");
    setDialog(d);
  }
  const close = () => !pending && setDialog(null);

  function submit(input: StatusInput | "reassign") {
    setError(null);
    start(async () => {
      const res = input === "reassign" ? await reassignQuery(queryId, member, remark) : await changeStatus(queryId, input);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDialog(null);
      router.refresh();
    });
  }

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const footer = (label: string, onClick: () => void, danger = false) => (
    <div className="flex justify-end gap-2 border-t border-sand-200 bg-sand-50 px-5 py-4">
      <button type="button" className={ui.btnSecondary} onClick={close} disabled={pending}>Cancel</button>
      <button type="button" className={danger ? ui.btnDanger : ui.btnPrimary} onClick={onClick} disabled={pending}>
        {pending ? "Saving..." : label}
      </button>
    </div>
  );
  const remarkField = (required: boolean, placeholder: string) => (
    <div>
      <label className={ui.label}>
        Remark{required ? <span className="text-error"> *</span> : <span className="normal-case tracking-normal"> (optional)</span>}
      </label>
      <textarea className={ui.input} rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder={placeholder} />
    </div>
  );
  const reasonField = (list: string[]) => (
    <div>
      <label className={ui.label}>Reason <span className="text-error">*</span></label>
      <select className={`${ui.select} w-full`} value={reason} onChange={(e) => setReason(e.target.value)}>
        {list.length === 0 && <option value="Other">Other</option>}
        {list.map((r) => <option key={r}>{r}</option>)}
      </select>
    </div>
  );

  if (!canAct) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {status === "open" && (
          <>
            <button type="button" className={ui.btnPrimary} onClick={() => open("booked")}>
              <Icon name="check" className="h-[18px] w-[18px]" />
              Mark booked
            </button>
            <button type="button" className={ui.btnSecondary} onClick={() => open("lost")}>Mark lost</button>
          </>
        )}
        {status === "booked" && (
          <button type="button" className={ui.btnDangerOutline} onClick={() => open("cancelled")}>Cancel booking</button>
        )}
        {(status === "lost" || status === "cancelled") && (
          <button type="button" className={ui.btnPrimary} onClick={() => open("open")}>Reopen</button>
        )}
        {isAdmin && (
          <button type="button" className={ui.btnGhost} onClick={() => open("reassign")}>
            <Icon name="users" className="h-[18px] w-[18px]" />
            Reassign
          </button>
        )}
      </div>

      {dialog === "booked" && (
        <Modal title="Mark as booked" subtitle={queryNo} onClose={close}>
          <div className="space-y-4 px-5 py-4">
            {error && <p className={ui.alertError}>{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={ui.label}>Amount received <span className="text-error">*</span></label>
                <input className={`${ui.input} tabular`} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
                {deposit ? <p className="mt-1 text-xs text-sand-500">Deposit due: {rupees(deposit)}</p> : null}
              </div>
              <div>
                <label className={ui.label}>Payment date <span className="text-error">*</span></label>
                <input className={ui.input} type="date" max={today} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className={ui.label}>Payment reference <span className="text-error">*</span></label>
              <input className={ui.input} value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="UTR / transaction ID / invoice no." />
            </div>
            {remarkField(false, "Anything the team should know")}
          </div>
          {footer("Confirm booking", () => submit({ to: "booked", amount: Number(amount), paymentRef, paymentDate, remark }))}
        </Modal>
      )}

      {dialog === "lost" && (
        <Modal title="Mark as lost" subtitle="The query moves to Lost & cancelled. It can be reopened later." onClose={close}>
          <div className="space-y-4 px-5 py-4">
            {error && <p className={ui.alertError}>{error}</p>}
            {reasonField(reasons.lost)}
            {remarkField(true, "What happened?")}
          </div>
          {footer("Mark lost", () => submit({ to: "lost", reason, remark }))}
        </Modal>
      )}

      {dialog === "cancelled" && (
        <Modal title="Cancel booking" subtitle="Use this when a booked guest cancels." onClose={close}>
          <div className="space-y-4 px-5 py-4">
            {error && <p className={ui.alertError}>{error}</p>}
            {reasonField(reasons.cancelled)}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={ui.label}>Cancellation charge</label>
                <input className={`${ui.input} tabular`} type="number" min={0} value={cancelCharge} onChange={(e) => setCancelCharge(e.target.value)} />
              </div>
              <div>
                <label className={ui.label}>Refund</label>
                <input className={`${ui.input} tabular`} type="number" min={0} value={refund} onChange={(e) => setRefund(e.target.value)} />
              </div>
            </div>
            {remarkField(true, "e.g. Visa refused; 20% charge applied per policy")}
          </div>
          {footer("Cancel booking", () => submit({ to: "cancelled", reason, remark, cancelCharge: num(cancelCharge), refund: num(refund) }), true)}
        </Modal>
      )}

      {dialog === "open" && (
        <Modal title="Reopen query" subtitle={`${queryNo} goes back to Open.`} onClose={close}>
          <div className="space-y-4 px-5 py-4">
            {error && <p className={ui.alertError}>{error}</p>}
            {remarkField(true, "e.g. Guest wrote back asking for new dates")}
          </div>
          {footer("Reopen", () => submit({ to: "open", remark }))}
        </Modal>
      )}

      {dialog === "reassign" && (
        <Modal title="Reassign query" subtitle={queryNo} onClose={close}>
          <div className="space-y-4 px-5 py-4">
            {error && <p className={ui.alertError}>{error}</p>}
            <div>
              <label className={ui.label}>Assign to <span className="text-error">*</span></label>
              <select className={`${ui.select} w-full`} value={member} onChange={(e) => setMember(e.target.value)}>
                <option value="" disabled>Choose...</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            {remarkField(false, "e.g. Priya on leave")}
          </div>
          {footer("Reassign", () => submit("reassign"))}
        </Modal>
      )}
    </>
  );
}
