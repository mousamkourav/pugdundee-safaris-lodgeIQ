"use server";

// SOP changes: super admin only. Like a simple CMS, every change goes LIVE at once: the change is
// made to the working copy (sop_sections) and published as the next version (sop_publish), with
// a note saying what changed. "Ask staff to read this update" marks that version for the banner.
// Every action checks the caller first (guard), and the database checks again (RLS and sop_*
// functions that refuse anyone but the super admin).
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sopEditor, loadVersion, loadVersionFull, SOP_BUCKET } from "@/lib/sop/server";
import { docHtml, docText, isUuid, sanitizeDoc, toDraftRows, importRows } from "@/lib/sop/content";
import { explainDbError, type DbError } from "@/lib/sop/errors";

type Fail = { error: string };
type Live = { ok: true; version: number };

async function run<T>(label: string, fn: () => Promise<T | Fail>): Promise<T | Fail> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[sop] ${label} failed:`, e);
    const msg = e instanceof Error ? e.message : String(e);
    return { error: explainDbError({ message: msg }) };
  }
}

// The caller, again, for the record: every exported action starts with this.
async function guard() {
  const cu = await getCurrentUser();
  if (!cu?.user) return { error: "Please sign in again." } as Fail;
  return sopEditor();
}

const cleanTitle = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
// The real reason, in plain words (lib/sop/errors.ts); the full error goes to the server log.
function dbError(e: DbError | null, label = "database"): Fail {
  console.error(`[sop] ${label}:`, e);
  return { error: explainDbError(e) };
}

// The working copy goes live as the next version.
async function goLive(documentId: string, note: string, ask: boolean): Promise<Live | Fail> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sop_publish", { p_doc: documentId, p_note: note.slice(0, 500), p_ask_read: ask });
  if (error) return dbError(error, "sop_publish");
  revalidatePath("/", "layout"); // the SOP page, and the banner on every page
  return { ok: true, version: Number(data) };
}

async function order(documentId: string): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("sop_sections").select("id, title").eq("document_id", documentId).order("position");
  return (data ?? []) as { id: string; title: string }[];
}
async function setOrder(documentId: string, ids: string[]) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sop_set_order", { p_doc: documentId, p_ids: ids });
  return error;
}

// ---------------------------------------------------------------- sections (each change goes live)

// Save one section (title and text) and make it live. ask = "Ask staff to read this update".
export async function saveSection(input: { id: string; title: string; body: unknown; ask?: boolean }): Promise<Live | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!isUuid(input?.id)) return { error: "Unknown section." };
  const title = cleanTitle(input.title);
  if (!title) return { error: "A section needs a title." };
  let body;
  try {
    body = sanitizeDoc(input.body);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "This section could not be saved." };
  }
  return run("saveSection", async () => {
    const supabase = await createClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("sop_sections")
      .update({ title, body_json: body, body_html: docHtml(body), body_text: docText(body), updated_at: now, updated_by: g.userId })
      .eq("id", input.id)
      .eq("document_id", g.documentId)
      .select("id");
    if (error) return dbError(error);
    if (!data?.length) return { error: "This section no longer exists (it may have been deleted or replaced by an import)." };
    await supabase.from("sop_documents").update({ draft_updated_at: now, draft_updated_by: g.userId }).eq("id", g.documentId);
    return goLive(g.documentId, `Edited: ${title}`, !!input.ask);
  });
}

export async function addSection(input: { title: string; afterId?: string | null }): Promise<(Live & { id: string }) | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  const title = cleanTitle(input?.title);
  if (!title) return { error: "Give the section a title." };
  return run("addSection", async () => {
    const ids = (await order(g.documentId)).map((s) => s.id);
    const supabase = await createClient();
    const body = { type: "doc", content: [{ type: "paragraph" }] };
    const { data, error } = await supabase
      .from("sop_sections")
      .insert({ document_id: g.documentId, position: ids.length, title, body_json: body, body_html: "<p></p>", body_text: "", updated_by: g.userId })
      .select("id")
      .single();
    if (error || !data) return dbError(error);
    const id = (data as { id: string }).id;
    const at = input.afterId ? ids.indexOf(input.afterId) : -1;
    if (at >= 0) {
      const e = await setOrder(g.documentId, [...ids.slice(0, at + 1), id, ...ids.slice(at + 1)]);
      if (e) return dbError(e);
    }
    const live = await goLive(g.documentId, `Added: ${title}`, false);
    return "error" in live ? live : { ...live, id };
  });
}

export async function moveSection(id: string, direction: "up" | "down"): Promise<Live | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!isUuid(id)) return { error: "Unknown section." };
  return run("moveSection", async () => {
    const list = await order(g.documentId);
    const ids = list.map((s) => s.id);
    const i = ids.indexOf(id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return { error: "This section cannot move further." };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const e = await setOrder(g.documentId, ids);
    if (e) return dbError(e);
    return goLive(g.documentId, `Moved ${direction}: ${list[i].title}`, false);
  });
}

export async function deleteSection(id: string): Promise<Live | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!isUuid(id)) return { error: "Unknown section." };
  return run("deleteSection", async () => {
    const list = await order(g.documentId);
    const gone = list.find((s) => s.id === id);
    if (!gone) return { error: "This section no longer exists." };
    if (list.length <= 1) return { error: "The SOP needs at least one section." };
    const supabase = await createClient();
    const { error } = await supabase.from("sop_sections").delete().eq("id", id).eq("document_id", g.documentId);
    if (error) return dbError(error);
    const e = await setOrder(g.documentId, list.filter((s) => s.id !== id).map((s) => s.id));
    if (e) return dbError(e);
    return goLive(g.documentId, `Deleted: ${gone.title}`, false);
  });
}

// ---------------------------------------------------------------- versions, reading

// An old version becomes live again, as a new version (old versions are never changed).
export async function restoreVersion(number: number): Promise<Live | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!Number.isInteger(number) || number < 1) return { error: "Unknown version." };
  return run("restoreVersion", async () => {
    const v = await loadVersion(g.documentId, number);
    if (!v) return { error: "Unknown version." };
    const rows = toDraftRows(await loadVersionFull(v.id));
    // one database step: the sections replaced AND live, or nothing changes
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sop_restore", { p_doc: g.documentId, p_sections: rows, p_from: number });
    if (error) return dbError(error, "sop_restore");
    revalidatePath("/", "layout");
    return { ok: true as const, version: Number(data) };
  });
}

// Show the "please read" banner to staff for the current version.
export async function askStaffToRead(): Promise<Live | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  return run("askStaffToRead", async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sop_ask_read", { p_doc: g.documentId });
    if (error) return dbError(error);
    revalidatePath("/", "layout");
    return { ok: true as const, version: Number(data) };
  });
}

// ---------------------------------------------------------------- uploads (browser -> storage)
// Files go straight from the browser to the private bucket with one-time upload links (a server
// action takes 1 MB at most). The server then reads what was uploaded. The Word file itself is
// never stored (owner, 4 Nov 2026: it is 122 MB; staff download the PDF).

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
type Upload = { path: string; token: string };

async function signedUpload(path: string): Promise<Upload> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(SOP_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "no upload link");
  return { path: data.path, token: data.token };
}

export async function createImageUpload(ext: string, size: number): Promise<({ ok: true; src: string } & Upload) | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  const e = String(ext).toLowerCase();
  if (!IMAGE_EXT.has(e)) return { error: "Pictures only (PNG, JPG, GIF, WEBP)." };
  if (!(size > 0 && size <= 10 * 1024 * 1024)) return { error: "Pictures up to 10 MB." };
  return run("createImageUpload", async () => {
    const path = `images/${randomUUID()}.${e === "jpeg" ? "jpg" : e}`;
    const up = await signedUpload(path);
    return { ok: true as const, src: `/sop/media/${path}`, ...up };
  });
}

export async function createImportUploads(input: { imageExts: string[] }): Promise<({ ok: true; json: Upload; images: (Upload & { src: string })[] }) | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  const exts = Array.isArray(input?.imageExts) ? input.imageExts.map((x) => String(x).toLowerCase()) : [];
  if (exts.length > 200 || exts.some((x) => !IMAGE_EXT.has(x))) return { error: "Unsupported pictures in the file." };
  return run("createImportUploads", async () => {
    const json = await signedUpload(`imports/${randomUUID()}.json`);
    const images: (Upload & { src: string })[] = [];
    for (const x of exts) {
      const path = `images/${randomUUID()}.${x === "jpeg" ? "jpg" : x}`;
      images.push({ ...(await signedUpload(path)), src: `/sop/media/${path}` });
    }
    return { ok: true as const, json, images };
  });
}

// The import: the uploaded sections replace the SOP and go live (one version), in place of all
// sections before. Old versions stay in the history.
export async function commitImport(input: { jsonPath: string; fileName: string; detail: Record<string, number | string>; ask?: boolean }): Promise<(Live & { sections: number }) | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!/^imports\/[0-9a-f-]{36}\.json$/.test(String(input?.jsonPath))) return { error: "Unknown upload." };
  return run("commitImport", async () => {
    const admin = createAdminClient();
    const file = await admin.storage.from(SOP_BUCKET).download(input.jsonPath);
    if (file.error || !file.data) return { error: "The upload was not found. Please import again." };
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.data.text());
    } catch {
      return { error: "The upload is damaged. Please import again." };
    }
    let rows;
    try {
      rows = importRows(parsed as { title?: unknown; body?: unknown }[]);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Nothing to import." };
    }
    const detail: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(input.detail ?? {})) if (/^[a-zA-Z]{1,30}$/.test(k) && (typeof v === "number" || typeof v === "string")) detail[k] = typeof v === "string" ? v.slice(0, 200) : v;
    const fileName = String(input.fileName ?? "").slice(0, 200);
    if (fileName) detail.file = fileName;

    // one database step: every section replaced AND live as the next version, or nothing changes
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sop_import", {
      p_doc: g.documentId,
      p_sections: rows,
      p_detail: detail,
      p_note: `Imported from Word${fileName ? ` (${fileName})` : ""}`,
      p_ask_read: !!input.ask,
    });
    if (error) return dbError(error, "sop_import");
    await admin.storage.from(SOP_BUCKET).remove([input.jsonPath]);
    revalidatePath("/", "layout");
    return { ok: true as const, version: Number(data), sections: rows.length };
  });
}

// ---------------------------------------------------------------- access

export async function grantAccess(input: { userId?: string; role?: string }): Promise<{ ok: true } | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  const userId = input?.userId && isUuid(input.userId) ? input.userId : null;
  const role = input?.role && /^[a-z_]{3,40}$/.test(input.role) ? input.role : null;
  if (!userId === !role) return { error: "Choose a person or a role." };
  return run("grantAccess", async () => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("sop_grant", { p_doc: g.documentId, p_user: userId, p_role: role });
    if (error) return dbError(error);
    revalidatePath("/sop/access");
    return { ok: true as const };
  });
}

export async function revokeAccess(accessId: string): Promise<{ ok: true } | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!isUuid(accessId)) return { error: "Unknown access." };
  return run("revokeAccess", async () => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("sop_revoke", { p_access: accessId });
    if (error) return dbError(error);
    revalidatePath("/sop/access");
    return { ok: true as const };
  });
}
