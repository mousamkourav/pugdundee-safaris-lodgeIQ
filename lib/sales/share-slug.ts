// Personalised client links: /i/sangeeta-ps-2026-0001-k8f3x9q2
// The name and quote number make it recognisable; the 8 random characters
// (about 2.8 trillion combinations) keep it impossible to guess.

const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // no look-alikes (l, 1, o, 0)

function randomPart(n = 8) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function makeShareSlug(guestName: string, queryNo: string): string {
  const name =
    guestName
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(mr|mrs|ms|miss|dr|prof|untitled draft)\b\.?/g, " ")
      .replace(/[^a-z0-9]+/g, "-")
      .split("-")
      .filter(Boolean)
      .slice(0, 3)
      .join("-")
      .slice(0, 40) || "guest";
  const q = queryNo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${name}-${q}-${randomPart()}`;
}

// Old links use the 32-character token; new ones the slug. Both keep working.
export const isShareToken = (s: string) => /^[0-9a-f]{32}$/.test(s);
export const isShareSlug = (s: string) => /^[a-z0-9-]{10,120}$/.test(s);
