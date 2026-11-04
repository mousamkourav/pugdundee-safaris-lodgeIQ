// The real reason a SOP change failed, in plain words, instead of "Could not save".
// Errors come from Supabase (PostgREST codes like PGRST202, Postgres codes like 42883) or from
// our own sop_* functions (their messages are already plain). Shown to the super admin only.

export interface DbError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
  status?: number;
}

export const RUN_SQL = "Please run supabase/sop_module.sql again in the Supabase SQL Editor (it is safe to run more than once).";

// Messages our database functions raise on purpose: shown as they are.
const OURS = /Only the super admin|Write what changed|The SOP is empty|No sections|Choose a person|Nothing is published|No such SOP|You do not have access|Unknown action/;

export function explainDbError(e: DbError | null | undefined): string {
  if (!e) return "Could not save. Please try again.";
  const msg = String(e.message ?? "");
  const all = `${e.code ?? ""} ${msg} ${e.details ?? ""} ${e.hint ?? ""}`;
  const fn = /function (?:public\.)?(sop_\w+)/.exec(all)?.[1];
  if (OURS.test(msg)) return msg.replace(/^.*?(Only the super admin|Write what changed|The SOP is empty|No sections|Choose a person|Nothing is published|No such SOP|You do not have access|Unknown action)/, "$1");
  // a database function or table this version of the app needs is not there (or is older)
  if (e.code === "PGRST202" || e.code === "42883" || /Could not find the function|function .* does not exist/i.test(all))
    return `The database is missing the SOP function ${fn ?? ""}`.trimEnd() + ` that this version of the app needs. ${RUN_SQL} Nothing was changed.`;
  if (e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(all)) return `The SOP tables are missing in the database. ${RUN_SQL}`;
  if (e.code === "42703" || /column .* does not exist/i.test(all)) return `The SOP tables in the database are out of date. ${RUN_SQL}`;
  if (e.code === "57014" || /statement timeout|canceling statement/i.test(all)) return "The database took too long to save this. Please try again; if it keeps happening, import fewer sections at a time.";
  if (e.status === 413 || e.code === "PGRST413" || /payload too large|request entity too large|body.*too large/i.test(all)) return "The file is too large to save in one go.";
  if (e.code === "42501" || /permission denied|row-level security/i.test(all)) return "The database refused this change (permission). Check that you are signed in as the super admin.";
  if (e.code === "23514" || e.code === "22001") return `A section could not be saved: ${msg.slice(0, 160)}`;
  if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network/i.test(all)) return "The database could not be reached. Please try again in a moment.";
  return `Could not save. The database said: ${msg.slice(0, 200) || e.code || "no reason given"}.`;
}
