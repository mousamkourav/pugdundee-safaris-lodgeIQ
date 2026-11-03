import Link from "next/link";
import { requireSopEditor, loadVersion, loadVersionTexts, loadDraftTexts } from "@/lib/sop/server";
import { diffIsEmpty, diffSections } from "@/lib/sop/content";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import type { Doc } from "@/lib/sop/types";
import { SopEditor } from "./editor";

export const metadata = { title: "Edit SOP" };

export default async function SopEditPage({ searchParams }: { searchParams: Promise<{ s?: string }> }) {
  const { documentId } = await requireSopEditor();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("sop_sections").select("id, title").eq("document_id", documentId).order("position");
  const sections = (data ?? []) as { id: string; title: string }[];

  if (!sections.length) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl">Edit the SOP</h1>
        <div className={ui.empty}>
          The draft is empty. Start by importing the Word file.
          <span className="mt-3 flex justify-center">
            <Link href="/sop/import" className={ui.btnPrimary}>
              Import from Word
            </Link>
          </span>
        </div>
      </div>
    );
  }

  const id = sections.some((s) => s.id === sp.s) ? sp.s! : sections[0].id;
  const [{ data: row }, latest, draft] = await Promise.all([
    supabase.from("sop_sections").select("id, title, body_json").eq("id", id).maybeSingle(),
    loadVersion(documentId),
    loadDraftTexts(documentId),
  ]);
  const current = row as { id: string; title: string; body_json: Doc };
  const changed = latest ? !diffIsEmpty(diffSections(await loadVersionTexts(latest.id), draft)) : true;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Edit the SOP (draft)</h1>
          <p className="mt-1 text-sm text-sand-500">
            {latest ? `Staff read version ${latest.number}. ` : "Nothing published yet. "}
            {changed ? "The draft has changes that are not published." : "The draft is the same as the published version."}
          </p>
        </div>
        <Link href="/sop/versions" className={changed ? ui.btnPrimary : ui.btnSecondary}>
          Publish...
        </Link>
      </div>
      <SopEditor key={current.id} sections={sections} current={{ id: current.id, title: current.title, body: current.body_json }} />
    </div>
  );
}
