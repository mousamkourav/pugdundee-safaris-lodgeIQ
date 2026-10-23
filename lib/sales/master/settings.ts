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
      { value: "EUR", label: "EUR" },
      { value: "GBP", label: "GBP" },
      { value: "AUD", label: "AUD" },
    ],
  },
  { name: "fx_mode", path: ["fx_mode"], label: "Exchange rates", type: "select", options: [{ value: "live", label: "Live (European Central Bank, daily)" }, { value: "manual", label: "Manual (the rates below)" }], help: "Live rates update daily; the rates below are used if the live service cannot be reached." },
  { name: "fx_margin_pct", path: ["fx_margin_pct"], label: "Exchange-rate cushion %", type: "number", help: "Optional. Lowers the rate a little to protect against it moving before the guest pays, e.g. 2." },
  { name: "fx_usd", path: ["fx", "USD"], label: "Rupees per 1 USD (fallback)", type: "number" },
  { name: "fx_eur", path: ["fx", "EUR"], label: "Rupees per 1 EUR (fallback)", type: "number" },
  { name: "fx_gbp", path: ["fx", "GBP"], label: "Rupees per 1 GBP (fallback)", type: "number" },
  { name: "fx_aud", path: ["fx", "AUD"], label: "Rupees per 1 AUD (fallback)", type: "number" },
  {
    name: "per_person_basis",
    path: ["per_person_basis"],
    label: "Per-person price divides by",
    type: "select",
    required: true,
    initial: "guests",
    options: [
      { value: "guests", label: "All guests (adults and children)" },
      { value: "adults", label: "Adults only" },
    ],
  },
  { name: "markup_pct", path: ["markup_pct"], label: "Default markup %", type: "number", empty: 0 },
  { name: "quote_validity_days", path: ["quote_validity_days"], label: "Quote valid for (days)", type: "int", empty: 15 },
  {
    name: "ai_parsing_enabled",
    path: ["ai_parsing_enabled"],
    label: "AI trip assistant (Google Gemini)",
    type: "bool",
    help: "Gemini reads every chat message, using your parks, lodges, glossary and past quotes; prices always come from your own rates. Needs GEMINI_API_KEY in Vercel (never stored here). Guest names, emails and phone numbers are removed before sending. If the AI is unavailable, the built-in reader is used.",
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
