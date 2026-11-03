import Link from "next/link";
import { requireSopEditor, loadVersion, loadVersionTexts, loadDraftTexts, namesOf, fmtDate, type VersionRow } from "@/lib/sop/server";
import { diffIsEmpty, diffSections } from "@/lib/sop/content";
import { createClient } from "@/lib/supabase/server";
import { ui } from "@/components/ui";
import { DiffView } from "../_ui/diff-view";
import { PublishForm } from "./publish-form";

export const metadata = { title: "SOP versions" };

export default async function SopVersionsPage() {
  const { documentId } = await requireSopEditor();
  const supabase = await createClient();
  const [{ data }, latest, draft] = await Promise.all([
    supabase.from("sop_versions").select("id, number, note, published_at, published_by").eq("document_id", documentId).order("number", { ascending: false }),
    loadVersion(documentId),
    loadDraftTexts(documentId),
  ]);
  const versions = (data ?? []) as VersionRow[];
  const diff = diffSections(latest ? await loadVersionTexts(latest.id) : [], draft);
  const names = await namesOf(versions.map((v) => v.published_by));
  const { data: readRows } = versions.length ? await supabase.from("sop_reads").select("version_id").in("version_id", versions.map((v) => v.id)) : { data: [] };
  const readCount = new Map<string, number>();
  for (const r of (readRows ?? []) as { version_id: string }[]) readCount.set(r.version_id, (readCount.get(r.version_id) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl">SOP versions</h1>

      <section className={`${ui.card} space-y-4 p-4 sm:p-6`}>
        <h2 className="text-lg">Publish the draft</h2>
        <div>
          <p className="mb-2 text-sm font-semibold text-sand-600">{latest ? `Draft compared with version ${latest.number}:` : "First version: every section is new."}</p>
          <DiffView diff={diff} empty="The draft is the same as the published version: nothing to publish." />
        </div>
        {!draft.length && <p className={ui.alertWarning}>The draft is empty. Import the Word file first.</p>}
        <PublishForm next={(latest?.number ?? 0) + 1} disabled={!draft.length || (!!latest && diffIsEmpty(diff))} />
      </section>

      <section className={`${ui.card} p-4 sm:p-6`}>
        <h2 className="text-lg">Published versions</h2>
        {!versions.length ? (
          <p className="mt-2 text-sm text-sand-500">None yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-sand-500">
                  <th className="py-2 pr-3">Version</th>
                  <th className="py-2 pr-3">Published</th>
                  <th className="py-2 pr-3">By</th>
                  <th className="py-2 pr-3">What changed</th>
                  <th className="py-2 pr-3">Read by</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} className="border-b border-sand-100 align-top">
                    <td className="py-2 pr-3">
                      <Link href={`/sop/versions/${v.number}`} className="font-semibold text-olive-700 hover:underline">
                        {v.number}
                      </Link>
                      {v.id === latest?.id && <span className="ml-2 rounded bg-olive-50 px-1.5 py-0.5 text-[11px] font-semibold text-olive-700">current</span>}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{fmtDate(v.published_at)}</td>
                    <td className="py-2 pr-3">{(v.published_by && names.get(v.published_by)) || "-"}</td>
                    <td className="py-2 pr-3">{v.note}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/sop/reads?v=${v.number}`} className="text-olive-700 hover:underline">
                        {readCount.get(v.id) ?? 0}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
