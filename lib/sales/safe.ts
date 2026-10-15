// Runs a server action body and turns any unexpected failure (database down,
// network timeout, a bug) into a friendly { error } the screen can show,
// instead of crashing the page. The real error goes to the server log.
export async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[sales] ${label} failed:`, e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network|timeout/i.test(msg)) {
      return { error: "The database could not be reached. Please try again in a moment." };
    }
    return { error: "Something went wrong on the server. Please try again; if it keeps happening, tell the admin." };
  }
}
