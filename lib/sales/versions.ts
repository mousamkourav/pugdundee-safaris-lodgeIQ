// Saving an edited quote: a new version (the old one and its client link are kept), or an
// update of the current version (same link, for a correction before it is sent). Pure.
export type VersionMode = "new" | "update";

// statuses after the quote went to the guest
const SENT = new Set(["quoted", "booked", "lost", "cancelled"]);
// a booked or closed quote is never changed in place: what the guest accepted stays as it was
const LOCKED = new Set(["booked", "cancelled", "lost"]);

export const defaultVersionMode = (status: string | null | undefined): VersionMode => (status && SENT.has(status) ? "new" : "update");
export const canUpdateInPlace = (status: string | null | undefined): boolean => !!status && !LOCKED.has(status);
