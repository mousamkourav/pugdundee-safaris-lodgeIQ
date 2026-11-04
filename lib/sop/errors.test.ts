// Run with:  npx tsx --test lib/sop/errors.test.ts
//
// "Could not save" was all the owner saw when Import and make live failed on the live site
// (4 Nov 2026): the database still had the previous sop_module.sql, so sop_publish with the
// read tick did not exist. Every failure now says its real reason.
import { test } from "node:test";
import assert from "node:assert/strict";
import { explainDbError, RUN_SQL } from "./errors";

test("a missing or older database function: names it and says to run sop_module.sql again; nothing changed", () => {
  // what Supabase (PostgREST) answers when the function with these arguments is not there
  const postgrest = explainDbError({
    code: "PGRST202",
    message: "Could not find the function public.sop_publish(p_ask_read, p_doc, p_note) in the schema cache",
    hint: "Perhaps you meant to call the function public.sop_publish(p_doc, p_note)",
  });
  assert.equal(postgrest, `The database is missing the SOP function sop_publish that this version of the app needs. ${RUN_SQL} Nothing was changed.`);
  // what Postgres itself says (the case reproduced with the real file on the previous SQL)
  assert.match(explainDbError({ code: "42883", message: "function sop_publish(unknown, unknown, boolean) does not exist" }), /missing the SOP function sop_publish .*sop_module\.sql again/);
  assert.match(explainDbError({ code: "PGRST202", message: "Could not find the function public.sop_import(p_ask_read, p_detail, p_doc, p_note, p_sections) in the schema cache" }), /sop_import/);
  assert.match(explainDbError({ code: "42P01", message: 'relation "public.sop_sections" does not exist' }), /SOP tables are missing.*sop_module\.sql/);
  assert.match(explainDbError({ code: "42703", message: 'column "ask_read" does not exist' }), /out of date.*sop_module\.sql/);
});

test("other reasons in plain words; our own messages as they are; anything else with the database's words", () => {
  assert.match(explainDbError({ code: "57014", message: "canceling statement due to statement timeout" }), /took too long/);
  assert.equal(explainDbError({ status: 413, message: "Payload Too Large" }), "The file is too large to save in one go.");
  assert.equal(explainDbError({ message: "request entity too large" }), "The file is too large to save in one go.");
  assert.match(explainDbError({ code: "42501", message: "permission denied for function sop__publish" }), /refused.*super admin/);
  assert.match(explainDbError({ message: "TypeError: fetch failed" }), /could not be reached/);
  assert.equal(explainDbError({ code: "P0001", message: "Only the super admin can publish the SOP." }), "Only the super admin can publish the SOP.");
  assert.equal(explainDbError({ code: "P0001", message: "The SOP is empty." }), "The SOP is empty.");
  assert.equal(explainDbError({ code: "XX000", message: "something odd" }), "Could not save. The database said: something odd.");
  assert.equal(explainDbError(null), "Could not save. Please try again.");
  assert.ok(!/^Could not save\. Please try again\.$/.test(explainDbError({ code: "PGRST202", message: "Could not find the function public.sop_publish" })), "never the bare message for a known cause");
});
