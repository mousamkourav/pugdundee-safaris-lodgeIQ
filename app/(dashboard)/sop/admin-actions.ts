"use server";

// SOP changes: super admin only. Every action checks the caller first (sopEditor), and the
// database checks again (RLS on sop_sections, and sop_* functions that refuse anyone else).
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sopEditor, loadVersion, loadVersionFull, SOP_BUCKET } from "@/lib/sop/server";
import { docHtml, docText, isUuid, sanitizeDoc, toDraftRows } from "@/lib/sop/content";

type Fail = { error: string };

async function run<T>(label: string, fn: () => Promise<T | Fail>): Promise<T | Fail> {
  try {
    return await fn();
  } catch (e) {
    console.error(`[sop] ${label} failed:`, e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|network|timeout/i.test(msg)) return { error: "The database could not be reached. Please try again in a moment." };
    return { error: "Something went wrong on the server. Please try again." };
  }
}

// The caller, again, for the record: every exported action starts with this.
async function guard() {
  const cu = await getCurrentUser();
  if (!cu?.user) return { error: "Please sign in again." } as Fail;
  return sopEditor();
}

const cleanTitle = (t: unknown) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
const dbError = (e: { message?: string } | null) => (e?.message?.match(/Only the super admin|Write what changed|The draft is empty|No sections|Choose a person/)?.[0] ? { error: e.message! } : { error: "Could not save. Please try again." });

function touched() {
  revalidatePath("/sop", "layout");
}

async function order(documentId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("sop_sections").select("id").eq("document_id", documentId).order("position");
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}
async function setOrder(documentId: string, ids: string[]) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sop_set_order", { p_doc: documentId, p_ids: ids });
  return error;
}

// ---------------------------------------------------------------- sections of the draft

// Autosave of one section (the editor calls it a moment after typing stops).
export async function saveSection(input: { id: string; title?: string; body?: unknown }): Promise<{ ok: true; savedAt: string } | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!isUuid(input?.id)) return { error: "Unknown section." };
  return run("saveSection", async () => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: g.userId };
    if (input.title !== undefined) {
      const title = cleanTitle(input.title);
      if (!title) return { error: "A section needs a title." };
      patch.title = title;
    }
    if (input.body !== undefined) {
      let body;
      try {
        body = sanitizeDoc(input.body);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "This section could not be saved." };
      }
      patch.body_json = body;
      patch.body_html = docHtml(body);
      patch.body_text = docText(body);
    }
    const supabase = await createClient();
    const { data, error } = await supabase.from("sop_sections").update(patch).eq("id", input.id).eq("document_id", g.documentId).select("id");
    if (error) return dbError(error);
    if (!data?.length) return { error: "This section no longer exists (it may have been deleted or replaced by an import)." };
    await supabase.from("sop_documents").update({ draft_updated_at: patch.updated_at, draft_updated_by: g.userId }).eq("id", g.documentId);
    return { ok: true as const, savedAt: String(patch.updated_at) };
  });
}

export async function addSection(input: { title: string; afterId?: string | null }): Promise<{ ok: true; id: string } | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  const title = cleanTitle(input?.title);
  if (!title) return { error: "Give the section a title." };
  return run("addSection", async () => {
    const ids = await order(g.documentId);
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
    touched();
    return { ok: true as const, id };
  });
}

export async function renameSection(id: string, title: string) {
  const g = await guard();
  if ("error" in g) return g;
  return saveSection({ id, title });
}

export async function moveSection(id: string, direction: "up" | "down"): Promise<{ ok: true } | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!isUuid(id)) return { error: "Unknown section." };
  return run("moveSection", async () => {
    const ids = await order(g.documentId);
    const i = ids.indexOf(id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return { ok: true as const };
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const e = await setOrder(g.documentId, ids);
    if (e) return dbError(e);
    touched();
    return { ok: true as const };
  });
}

export async function deleteSection(id: string): Promise<{ ok: true } | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!isUuid(id)) return { error: "Unknown section." };
  return run("deleteSection", async () => {
    const ids = await order(g.documentId);
    if (ids.length <= 1) return { error: "The SOP needs at least one section." };
    const supabase = await createClient();
    const { error } = await supabase.from("sop_sections").delete().eq("id", id).eq("document_id", g.documentId);
    if (error) return dbError(error);
    const e = await setOrder(g.documentId, ids.filter((x) => x !== id));
    if (e) return dbError(e);
    touched();
    return { ok: true as const };
  });
}

// ---------------------------------------------------------------- publish, restore

export async function publishSop(note: string): Promise<{ ok: true; version: number } | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  const text = String(note ?? "").trim();
  if (!text) return { error: "Write in a few words what changed." };
  if (text.length > 500) return { error: "Keep the note under 500 characters." };
  return run("publishSop", async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sop_publish", { p_doc: g.documentId, p_note: text });
    if (error) return dbError(error);
    revalidatePath("/", "layout"); // the banner, on every page
    return { ok: true as const, version: Number(data) };
  });
}

// An old version becomes the draft again (published versions are never changed).
export async function restoreVersion(number: number): Promise<{ ok: true } | Fail> {
  const g = await guard();
  if ("error" in g) return g;
  if (!Number.isInteger(number) || number < 1) return { error: "Unknown version." };
  return run("restoreVersion", async () => {
    const v = await loadVersion(g.documentId, number);
    if (!v) return { error: "Unknown version." };
    const rows = toDraftRows(await loadVersionFull(v.id));
    const supabase = await createClient();
    const { error } = await supabase.rpc("sop_replace_draft", { p_doc: g.documentId, p_sections: rows, p_action: "restore", p_detail: { from_version: number } });
    if (error) return dbError(error);
    touched();
    return { ok: true as const };
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

// The import, saved: the uploaded sections become the draft (in one transaction, with the audit).
export async function commitImport(input: {
  jsonPath: string;
  fileName: string; // kept in the audit log only
  detail: Record<string, number | string>;
}): Promise<{ ok: true; sections: number } | Fail> {
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
      rows = toDraftRows(parsed as { title?: unknown; body?: unknown }[]).map((r) => {
        const rest = { ...r };
        delete rest.id; // imported sections are new sections
        return rest;
      });
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Nothing to import." };
    }
    const detail: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(input.detail ?? {})) if (/^[a-zA-Z]{1,30}$/.test(k) && (typeof v === "number" || typeof v === "string")) detail[k] = typeof v === "string" ? v.slice(0, 200) : v;
    if (input.fileName) detail.file = String(input.fileName).slice(0, 200);

    const supabase = await createClient();
    const { error } = await supabase.rpc("sop_replace_draft", { p_doc: g.documentId, p_sections: rows, p_action: "import", p_detail: detail });
    if (error) return dbError(error);
    await admin.storage.from(SOP_BUCKET).remove([input.jsonPath]);
    touched();
    return { ok: true as const, sections: rows.length };
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
