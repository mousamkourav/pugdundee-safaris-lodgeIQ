// URL-friendly slug from a lodge name, e.g. "Kanha Earth Lodge" -> "kanha-earth-lodge".
// Kept in its own file (no server imports) so client components can use it.
export function lodgeSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
