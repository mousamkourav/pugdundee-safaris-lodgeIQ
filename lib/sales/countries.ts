// Countries and phone numbers for guest details. Country names are a fixed list
// (country-names.ts), phone rules from libphonenumber-js (Google's data),
// so every country is covered and each number length is checked exactly.
// The "core" entry with the data passed in explicitly works the same in Next.js,
// in the browser and in the test runner.
import {
  Metadata,
  getCountries as getCountriesCore,
  getCountryCallingCode as getCallingCore,
  isValidPhoneNumber as isValidCore,
  parsePhoneNumberFromString as parseCore,
  validatePhoneNumberLength as lengthCore,
  type CountryCode,
  type MetadataJson,
} from "libphonenumber-js/core";
// "max" data knows the exact MOBILE length of every country (India 10, UK 10, UAE 9...).
import metadataJson from "libphonenumber-js/metadata.max.json";
import { COUNTRY_NAMES } from "./country-names";

const metadata = metadataJson as unknown as MetadataJson;
const getCountries = () => getCountriesCore(metadata);
const getCountryCallingCode = (c: CountryCode) => getCallingCore(c, metadata);
const isValidPhoneNumber = (n: string, c: CountryCode) => isValidCore(n, c, metadata);
const parsePhoneNumberFromString = (n: string, c: CountryCode) => parseCore(n, c, metadata);
const validatePhoneNumberLength = (n: string, c: CountryCode) => lengthCore(n, c, metadata);


export interface Country {
  code: CountryCode;
  name: string;
  dial: string;
}

export const COUNTRIES: Country[] = getCountries()
  .map((code) => ({ code, name: COUNTRY_NAMES[code] ?? code, dial: getCountryCallingCode(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code as string, c]));

export const countryName = (code: string) => BY_CODE.get(code)?.name ?? "";
export const isCountry = (code: string): code is CountryCode => BY_CODE.has(code);

// Regional-indicator letters make the flag emoji (built at runtime; the source stays ASCII).
export const flag = (code: string) => (/^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "");

type Plan = { possibleLengths(): number[]; type(t: string): { possibleLengths(): number[] } | undefined };
const lengthCache = new Map<string, number[]>();

// Lengths of a mobile number in this country (without the country code).
// Guests give mobiles, so the field allows exactly these lengths.
export function mobileLengths(country: string): number[] {
  if (!isCountry(country)) return [];
  if (!lengthCache.has(country)) {
    const m = new Metadata(metadata);
    m.selectNumberingPlan(country);
    const plan = m.numberingPlan as unknown as Plan;
    const mobile = plan.type("MOBILE")?.possibleLengths() ?? [];
    lengthCache.set(country, mobile.length ? mobile : plan.possibleLengths());
  }
  return lengthCache.get(country)!;
}

export const maxPhoneDigits = (country: string) => Math.max(0, ...mobileLengths(country)) || 15;

// Would these digits still fit a phone number of this country? (Used to stop typing extra digits.)
export function phoneFits(country: string, digits: string) {
  if (!digits || !isCountry(country)) return true;
  return digits.length <= maxPhoneDigits(country) && validatePhoneNumberLength(digits, country) !== "TOO_LONG";
}

export function phoneValid(country: string, digits: string) {
  return isCountry(country) && mobileLengths(country).includes(digits.length) && isValidPhoneNumber(digits, country);
}

export function phoneHint(country: string) {
  const l = mobileLengths(country);
  if (!l.length) return "";
  return `${countryName(country)} mobile numbers have ${l.length === 1 ? l[0] : `${Math.min(...l)} to ${Math.max(...l)}`} digits after +${getCountryCallingCode(country as CountryCode)}.`;
}

const mainCountryFor = (callingCode: string) =>
  ((metadata as unknown as { country_calling_codes: Record<string, string[]> }).country_calling_codes[callingCode] ?? [])[0] ?? null;

// +919876543210 style, or "" when there are no digits.
export function toInternational(country: string, digits: string) {
  if (!digits) return "";
  if (!isCountry(country)) return digits;
  return parsePhoneNumberFromString(digits, country)?.number ?? `+${getCountryCallingCode(country)}${digits}`;
}

// Split a stored number back into country + national digits for editing.
export function splitPhone(stored: string, fallbackCountry: string) {
  if (!stored) return { country: fallbackCountry, national: "" };
  const p = parsePhoneNumberFromString(stored, isCountry(fallbackCountry) ? fallbackCountry : "IN");
  if (p) return { country: (p.country as string) ?? mainCountryFor(p.countryCallingCode as string) ?? fallbackCountry, national: p.nationalNumber as string };
  // Unparseable (e.g. half-typed): drop a leading +<country code> so it is not read as digits.
  const dial = isCountry(fallbackCountry) ? getCountryCallingCode(fallbackCountry) : "";
  const digits = stored.replace(/\D/g, "");
  return { country: fallbackCountry, national: stored.startsWith("+") && dial && digits.startsWith(dial) ? digits.slice(dial.length) : digits };
}

// Read a phone number out of free text, e.g. "+44 7700 900123" or "98260 12345".
export function findPhone(text: string, defaultCountry = "IN") {
  const m = text.match(/(?:\+|\b)\d[\d\s-]{8,}\d\b/);
  if (!m) return null;
  const p = parsePhoneNumberFromString(m[0], isCountry(defaultCountry) ? defaultCountry : "IN");
  return p && p.isPossible() ? { phone: p.number as string, country: (p.country as string) ?? mainCountryFor(p.countryCallingCode as string) ?? defaultCountry } : null;
}

// Nationality words people write, mapped to a country.
const DEMONYMS: Record<string, string> = {
  indian: "IN", british: "GB", english: "GB", uk: "GB", american: "US", usa: "US", us: "US", german: "DE", french: "FR",
  italian: "IT", spanish: "ES", dutch: "NL", swiss: "CH", belgian: "BE", australian: "AU", canadian: "CA", japanese: "JP",
  chinese: "CN", russian: "RU", israeli: "IL", singaporean: "SG", emirati: "AE", uae: "AE", irish: "IE", swedish: "SE",
  norwegian: "NO", danish: "DK", austrian: "AT", "new zealander": "NZ", kiwi: "NZ", south: "", sri: "",
};

export function findCountry(text: string): string | null {
  const low = ` ${text.toLowerCase()} `;
  for (const [word, code] of Object.entries(DEMONYMS)) {
    if (code && new RegExp(`\\b${word}s?\\b`).test(low) && !(word === "us" && !/\b(from|guests?) us\b/.test(low))) return code;
  }
  // "from Germany", "guests from the United Kingdom"
  for (const c of COUNTRIES) {
    if (c.name.length >= 4 && new RegExp(`\\b(?:from|of|nationals?)\\s+(?:the\\s+)?${c.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(low)) return c.code;
  }
  return null;
}
