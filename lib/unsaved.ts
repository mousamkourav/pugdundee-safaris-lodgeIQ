// Tiny client-side flag: does the monthly form have edits that are not saved
// yet? The form sets it; the lodge/month picker reads it to warn before
// switching away (switching remounts the form and drops unsaved input).
let unsaved = false;

export function setUnsaved(v: boolean): void {
  unsaved = v;
}

export function hasUnsaved(): boolean {
  return unsaved;
}
