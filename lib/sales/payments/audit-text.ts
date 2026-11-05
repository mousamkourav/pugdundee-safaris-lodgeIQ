// One line of a booking's history, in plain words, from an audit row (old / new row).
type Row = Record<string, unknown>;

const LABEL: Record<string, string> = {
  amount: "amount",
  paid_on: "date",
  mode: "how",
  kind: "type",
  reference: "reference",
  received_by: "received by",
  note: "note",
  line_id: "lodge",
  attachment_path: "receipt",
  guest_name: "guest",
  check_in: "check-in",
  check_out: "check-out",
  other_amount: "other",
  discount_amount: "discount",
  cancelled: "cancelled",
  notes: "notes",
  owner_id: "salesperson",
  lodge_name: "lodge",
  booking_no: "booking no.",
  rooms: "rooms",
  nights: "nights",
  room_amount: "rooms Rs",
  safari_amount: "safaris Rs",
  transfer_amount: "transfers Rs",
  label: "what",
  due_on: "due on",
};
const SKIP = new Set(["updated_at", "created_at", "change_reason", "sort", "id", "booking_id", "created_by"]);
const MONEY = new Set(["amount", "other_amount", "discount_amount", "room_amount", "safari_amount", "transfer_amount"]);
const INR = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const show = (k: string, v: unknown) => (v === null || v === undefined || v === "" ? "-" : MONEY.has(k) ? `Rs ${INR.format(Number(v))}` : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));
const THING: Record<string, string> = { sales_bookings: "the booking", sales_booking_lines: "a lodge booking", sales_booking_dues: "a due date", sales_booking_payments: "a payment" };

export function auditText(a: { table_name: string; action: string; old_row: Row | null; new_row: Row | null; actor: string | null }, names: Record<string, string>): string {
  const who = (a.actor && names[a.actor]) || "Someone";
  const row = a.new_row ?? a.old_row ?? {};
  let thing = THING[a.table_name] ?? a.table_name;
  if (a.table_name === "sales_booking_payments") {
    const kind = String(row.kind ?? "payment").replace("_", " ");
    thing = `a ${kind} of ${show("amount", row.amount)}`;
  }
  if (a.table_name === "sales_booking_lines") thing = `the lodge booking ${[row.lodge_name, row.booking_no].filter(Boolean).join(" ") || ""}`.trim();
  if (a.action === "insert") return `${who} added ${thing}.`;
  if (a.action === "delete") return `${who} removed ${thing}.`;
  const o = a.old_row ?? {};
  const n = a.new_row ?? {};
  if (!o.deleted_at && n.deleted_at) return `${who} removed ${thing}.`;
  const changes = Object.keys(n)
    .filter((k) => !SKIP.has(k) && k !== "deleted_at" && JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null))
    .map((k) => `${LABEL[k] ?? k} ${show(k, o[k])} to ${show(k, n[k])}`);
  return changes.length ? `${who} changed ${thing}: ${changes.join(", ")}.` : `${who} saved ${thing}.`;
}
