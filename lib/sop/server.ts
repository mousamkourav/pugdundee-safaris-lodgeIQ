// SOP: server-side access checks and loaders. Every SOP page calls requireSopViewer() or
// requireSopEditor(); every server action and route calls sopActor() / sopEditor(). The
// database checks again (RLS and the sop_* functions), so these are the first of two locks.
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser, getCurrentUser, homePathFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSopEditor, readStatus, NO_SOP, type SopStatus } from "./access";
import type { Doc, SectionText } from "./types";

export const SOP_BUCKET = "sop-media";

// One call per request (the layout and the page share it). If the SOP tables are not there yet
// (SQL not run), or anything fails, the answer is "no access": the tab stays hidden.
export const sopStatus = cache(async (): Promise<SopStatus> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("sop_my_status");
    if (error) return NO_SOP;
    return readStatus(data);
  } catch {
    return NO_SOP;
  }
});

// Pages: no access -> back to the user's own home.
export async function requireSopViewer() {
  const { user, profile } = await requireUser();
  const status = await sopStatus();
  if (!status.canView || !status.documentId) redirect(homePathFor(profile?.role));
  return { user, profile, status, documentId: status.documentId };
}

// Pages for the super admin only (edit, import, versions, access, who has read, audit).
export async function requireSopEditor() {
  const { user, profile } = await requireUser();
  const status = await sopStatus();
  if (!isSopEditor(profile?.role) || !status.isEditor || !status.documentId) redirect(status.canView ? "/sop" : homePathFor(profile?.role));
  return { user, profile, status, documentId: status.documentId };
}

type Denied = { error: string };
// Server actions and routes: the signed-in user with SOP access, or an error.
export async function sopActor(): Promise<Denied | { userId: string; role: string; status: SopStatus; documentId: string }> {
  const cu = await getCurrentUser();
  if (!cu?.user) return { error: "Please sign in again." };
  const status = await sopStatus();
  if (!status.canView || !status.documentId) return { error: "You do not have access to the SOP." };
  return { userId: cu.user.id, role: String(cu.profile?.role ?? ""), status, documentId: status.documentId };
}

export async function sopEditor(): Promise<Denied | { userId: string; documentId: string }> {
  const a = await sopActor();
  if ("error" in a) return a;
  if (!isSopEditor(a.role) || !a.status.isEditor) return { error: "Only the super admin can change the SOP." };
  return { userId: a.userId, documentId: a.documentId };
}

// ---------------------------------------------------------------- published versions

export interface VersionRow {
  id: string;
  number: number;
  note: string;
  published_at: string;
  published_by: string | null;
  ask_read: boolean;
}

export async function loadVersion(documentId: string, number?: number): Promise<VersionRow | null> {
  const supabase = await createClient();
  let q = supabase.from("sop_versions").select("id, number, note, published_at, published_by, ask_read").eq("document_id", documentId);
  q = number != null ? q.eq("number", number) : q.order("number", { ascending: false }).limit(1);
  const { data } = await q.maybeSingle();
  return (data as VersionRow | null) ?? null;
}

// The live version; an imported SOP that was never published becomes version 1 the first time
// anyone who may read it opens the SOP (once; the database does nothing when a version exists).
export async function loadLiveVersion(documentId: string): Promise<VersionRow | null> {
  const live = await loadVersion(documentId);
  if (live) return live;
  try {
    const supabase = await createClient();
    const { error } = await supabase.rpc("sop_publish_first", { p_doc: documentId });
    if (error) return null;
  } catch {
    return null;
  }
  return loadVersion(documentId);
}

// The sections the super admin edits (id and title, in order).
export async function loadWorkingList(documentId: string): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("sop_sections").select("id, title").eq("document_id", documentId).order("position");
  return (data ?? []) as { id: string; title: string }[];
}

// The contents list of a version (no bodies).
export async function loadToc(versionId: string): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("sop_version_sections").select("section_id, title").eq("version_id", versionId).order("position");
  return ((data ?? []) as { section_id: string; title: string }[]).map((r) => ({ id: r.section_id, title: r.title }));
}

export async function loadVersionSection(versionId: string, sectionId: string): Promise<{ id: string; title: string; body: Doc } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("sop_version_sections").select("section_id, title, body_json").eq("version_id", versionId).eq("section_id", sectionId).maybeSingle();
  const r = data as { section_id: string; title: string; body_json: Doc } | null;
  return r ? { id: r.section_id, title: r.title, body: r.body_json } : null;
}

export async function loadVersionTexts(versionId: string): Promise<SectionText[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("sop_version_sections").select("section_id, title, body_text").eq("version_id", versionId).order("position");
  return ((data ?? []) as { section_id: string; title: string; body_text: string }[]).map((r) => ({ id: r.section_id, title: r.title, text: r.body_text }));
}

export async function loadVersionFull(versionId: string): Promise<{ id: string; title: string; body: Doc; text: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("sop_version_sections").select("section_id, title, body_json, body_text").eq("version_id", versionId).order("position");
  return ((data ?? []) as { section_id: string; title: string; body_json: Doc; body_text: string }[]).map((r) => ({ id: r.section_id, title: r.title, body: r.body_json, text: r.body_text }));
}

// The draft (super admin).
export async function loadDraftTexts(documentId: string): Promise<SectionText[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("sop_sections").select("id, title, body_text").eq("document_id", documentId).order("position");
  return ((data ?? []) as { id: string; title: string; body_text: string }[]).map((r) => ({ id: r.id, title: r.title, text: r.body_text }));
}

// Names of the people in the audit / versions lists.
export async function namesOf(ids: (string | null)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", want);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || "(no name)"]));
}

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso));
export const fmtDay = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(iso));
