import type { FieldDef } from "./types";

// Fields of the single-row sales_settings.data jsonb. The "path" maps a form
// field to its key inside data. NEVER rename a path once data is saved.
export const SETTINGS_FIELDS: (FieldDef & { path: string[] })[] = [
  { name: "company_name", path: ["company", "name"], label: "Company name", type: "text", initial: "Pugdundee Safaris" },
  { name: "company_email", path: ["company", "email"], label: "Reservations email", type: "text" },
  { name: "company_phone", path: ["company", "phone"], label: "Reservations phone", type: "text" },
  { name: "company_gst", path: ["company", "gst"], label: "GST number", type: "text" },
  {
    name: "currency_default",
    path: ["currency_default"],
    label: "Default quote currency",
    type: "select",
    required: true,
    options: [
      { value: "INR", label: "INR" },
      { value: "USD", label: "USD" },
    ],
  },
  { name: "fx_usd", path: ["fx", "USD"], label: "Rupees per 1 USD", type: "number", help: "Used to show USD prices. Update when the rate moves." },
  { name: "markup_pct", path: ["markup_pct"], label: "Default markup %", type: "number", empty: 0 },
  { name: "quote_validity_days", path: ["quote_validity_days"], label: "Quote valid for (days)", type: "int", empty: 15 },
  {
    name: "ai_parsing_enabled",
    path: ["ai_parsing_enabled"],
    label: "AI reading of trip descriptions",
    type: "bool",
    help: "Off = only the built-in text reader and the form are used. The API key lives in Vercel, never here.",
  },
  {
    name: "payment_slabs",
    path: ["payment_slabs"],
    label: "Payment schedule",
    type: "json",
    wide: true,
    empty: [],
    help: 'List of instalments. days_before_arrival null = at booking. Percentages must add up to 100.',
  },
  {
    name: "cancellation_slabs",
    path: ["cancellation_slabs"],
    label: "Cancellation charges",
    type: "json",
    wide: true,
    empty: [],
    help: "Charge % by days before arrival. max_days null = no upper limit.",
  },
];

export function getPath(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

export function setPath(obj: Record<string, unknown>, path: string[], value: unknown) {
  let cur = obj;
  path.slice(0, -1).forEach((k) => {
    if (!cur[k] || typeof cur[k] !== "object" || Array.isArray(cur[k])) cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  });
  cur[path[path.length - 1]] = value;
}
