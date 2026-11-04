// Plain data for server actions. A server action receives only plain objects (prototype
// Object.prototype) and arrays from the browser; anything else becomes an opaque "temporary
// client reference" on the server, and reading a property of it throws ("Cannot access start on
// the server. You cannot dot into a temporary client reference ...").
// TipTap's editor.getJSON() hands over ProseMirror's own attrs objects, made with
// Object.create(null) (owner, 4 Nov 2026: Save failed on a section with a numbered list, whose
// attrs.start the server reads). So the editor sends toPlainJson(editor.getJSON()).
// Plain module (no "use client"): used by the editor in the browser and by tests.

export function toPlainJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// true when every object inside is a plain object or an array (what a server action can read)
export function isPlainData(value: unknown): boolean {
  if (value === null || typeof value !== "object") return typeof value !== "function" && typeof value !== "symbol" && typeof value !== "bigint";
  if (Array.isArray(value)) return value.every(isPlainData);
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.values(value as Record<string, unknown>).every(isPlainData);
}

// What a server action says when the browser sent something it cannot read.
export const NOT_PLAIN = "The editor sent this section in a form the server cannot read. Please reload the page and save again.";
export const isTemporaryReferenceError = (e: unknown) => /temporary client reference/i.test(e instanceof Error ? e.message : String(e));
