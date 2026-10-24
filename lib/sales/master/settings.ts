import type { FieldDef } from "./types";

// Guest page defaults, used until Sales settings are saved with other values.
export const DIRECT_CONTACTS_DEFAULT = ["enquiry@pugdundeesafaris.com", "sales@pugdundeesafaris.com", "+91-11-40146400", "+91-11-40132103", "reservation@pugdundeesafaris.com"];
export const WHATSAPP_DEFAULT = {
  number: "919810402034",
  text: "Hello, I saw your Pugdundee website and am interested to know more.",
  link: "https://wa.me/message/RT3RQ4ZICJLHI1",
};

// The WhatsApp button's link: a chat with the message filled in, else the plain link.
export function whatsappHref(number: unknown, text: unknown, link: unknown): string {
  const digits = String(number ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return `https://wa.me/${digits}${String(text ?? "").trim() ? `?text=${encodeURIComponent(String(text).trim())}` : ""}`;
  const l = String(link ?? "").trim();
  return /^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(l) ? l : WHATSAPP_DEFAULT.link;
}

// Fields of the single-row sales_settings.data jsonb. The "path" maps a form
// field to its key inside data. NEVER rename a path once data is saved.
export const SETTINGS_FIELDS: (FieldDef & { path: string[] })[] = [
  { name: "company_name", path: ["company", "name"], label: "Company name", type: "text", initial: "Pugdundee Safaris" },
  { name: "company_email", path: ["company", "email"], label: "Reservations email", type: "text" },
  { name: "company_phone", path: ["company", "phone"], label: "Reservations phone", type: "text" },
  { name: "company_gst", path: ["company", "gst"], label: "GST number", type: "text" },
  {
    name: "direct_guest_contacts",
    path: ["guest_page", "direct_contacts"],
    label: "Emergency contact on the itinerary",
    type: "textarea",
    wide: true,
    initial: DIRECT_CONTACTS_DEFAULT.join("\n"),
    help: "One email or phone number per line; phone numbers next to each other share a line. Shown under Emergency contact at the bottom of every guest itinerary and PDF.",
  },
  { name: "whatsapp_number", path: ["guest_page", "whatsapp_number"], label: "WhatsApp number (guest page button)", type: "text", initial: WHATSAPP_DEFAULT.number, help: "With country code, digits only, e.g. 919810402034." },
  { name: "whatsapp_text", path: ["guest_page", "whatsapp_text"], label: "WhatsApp message, filled in for the guest", type: "text", wide: true, initial: WHATSAPP_DEFAULT.text },
  { name: "whatsapp_link", path: ["guest_page", "whatsapp_link"], label: "WhatsApp link (used when there is no number)", type: "text", wide: true, initial: WHATSAPP_DEFAULT.link },
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
  {
    name: "hike_label",
    path: ["rate_hike", "label"],
    label: "Yearly hike: season name",
    type: "text",
    placeholder: "e.g. 2027-28",
    help: "For quoting next season before its rates are in master data: dates in this period use last year's rates plus the % below.",
  },
  { name: "hike_from", path: ["rate_hike", "from"], label: "Yearly hike: from", type: "date", placeholder: "2027-07-01" },
  { name: "hike_to", path: ["rate_hike", "to"], label: "Yearly hike: to", type: "date", placeholder: "2028-06-30" },
  { name: "hike_hotels_pct", path: ["rate_hike", "hotels_pct"], label: "Hike % on hotels (rooms)", type: "number", empty: 0 },
  { name: "hike_safaris_pct", path: ["rate_hike", "safaris_pct"], label: "Hike % on safaris", type: "number", empty: 0 },
  { name: "hike_transfers_pct", path: ["rate_hike", "transfers_pct"], label: "Hike % on transfers", type: "number", empty: 0, help: "Transfer rates without an end date get this % for dates in the hike period." },
  { name: "hike_addons_pct", path: ["rate_hike", "addons_pct"], label: "Hike % on add-ons and experiences", type: "number", empty: 0, help: "Add-ons have one price list (no dates): this % is added for dates in the hike period." },
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
