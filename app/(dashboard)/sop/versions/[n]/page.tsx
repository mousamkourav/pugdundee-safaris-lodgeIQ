import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSopEditor, loadVersion, loadToc, loadVersionSection, loadVersionTexts, namesOf, fmtDate, fmtDay } from "@/lib/sop/server";
import { diffSections, searchSections } from "@/lib/sop/content";
import { ui } from "@/components/ui";
import { SopReader } from "../../_ui/reader";
import { DiffView } from "../../_ui/diff-view";
import { RestoreButton } from "../publish-form";

export const metadata = { title: "SOP version" };

// Any old version, as it was published; what changed from the one before; restore as the draft.
export default async function SopVersionPage({ params, searchParams }: { params: Promise<{ n: string }>; searchParams: Promise<{ s?: string; q?: string }> }) {
  const { documentId } = await requireSopEditor();
  const n = Number((await params).n);
  if (!Number.isInteger(n) || n < 1) notFound();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const [version, latest] = await Promise.all([loadVersion(documentId, n), loadVersion(documentId)]);
  if (!version) notFound();
  const prev = n > 1 ? await loadVersion(documentId, n - 1) : null;
  const [toc, texts, prevTexts, names] = await Promise.all([
    loadToc(version.id),
    loadVersionTexts(version.id),
    prev ? loadVersionTexts(prev.id) : Promise.resolve([]),
    namesOf([version.published_by]),
  ]);
  const hits = q ? searchSections(texts, q) : null;
  const wanted = sp.s && toc.some((t) => t.id === sp.s) ? sp.s : toc[0]?.id;
  const section = !hits && wanted ? await loadVersionSection(version.id, wanted) : null;

  const top = (
    <div className="sop-noprint space-y-3">
      <Link href="/sop/versions" className="text-sm font-medium text-olive-700 hover:underline">
        &larr; All versions
      </Link>
      <div className={`${ui.card} flex flex-wrap items-start justify-between gap-4 p-4 sm:p-6`}>
        <div className="min-w-0">
          <h1 className="text-2xl">
            Version {version.number} {version.id === latest?.id ? "(current)" : "(old)"}
          </h1>
          <p className="mt-1 text-sm text-sand-500">
            Published {fmtDate(version.published_at)} by {(version.published_by && names.get(version.published_by)) || "-"}. What changed: {version.note}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/sop/pdf?v=${version.number}`} className={`${ui.btnSecondary} ${ui.btnSm}`}>
            Download PDF
          </a>
          <RestoreButton number={version.number} />
        </div>
      </div>
    </div>
  );
  const aside = (
    <div className={`${ui.card} mt-4 p-4`}>
      <p className="mb-2 text-sm font-semibold text-sand-600">{prev ? `What changed since version ${prev.number}` : "The first version"}</p>
      {prev ? <DiffView diff={diffSections(prevTexts, texts)} /> : <p className="text-sm text-sand-500">{texts.length} sections.</p>}
    </div>
  );

  return <SopReader basePath={`/sop/versions/${version.number}`} toc={toc} section={section} q={q} hits={hits} versionLabel={`Version ${version.number}, ${fmtDay(version.published_at)}`} top={top} aside={aside} />;
}
