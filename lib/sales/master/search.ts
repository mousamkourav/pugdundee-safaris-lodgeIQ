// Search for the master data lists. Pure functions, shared by the server page
// (which builds each row's search text) and the browser (which matches it).

// Lower-case, no accents, punctuation as spaces: "Tadoba-Andhari" matches "tadoba andhari".
export const normaliseSearch = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();

// Every word typed must appear somewhere in the row ("kings deluxe ap").
export function matchesSearch(haystack: string, query: string) {
  const words = normaliseSearch(query).split(" ").filter(Boolean);
  return words.every((w) => haystack.includes(w));
}
