import Link from "next/link";
import { requireSopViewer, loadVersion, loadToc, loadVersionSection, loadVersionTexts, fmtDay } from "@/lib/sop/server";
import { showReadBanner } from "@/lib/sop/access";
import { searchSections } from "@/lib/sop/content";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icons";
import { ui } from "@/components/ui";
import { SopReader } from "./_ui/reader";
import { AckButton } from "./_ui/ack-button";

export const metadata = { title: "SOP" };

// The SOP as published: what every member of staff with access reads.
export default async function SopPage({ searchParams }: { searchParams: Promise<{ s?: string; q?: string }> }) {
  const { status, documentId } = await requireSopViewer();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);
  const version = await loadVersion(documentId);

  if (!version) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl">Standard Operating Procedures</h1>
        <div className={ui.empty}>
          The SOP has not been published yet.
          {status.isEditor && (
            <span className="mt-3 flex justify-center gap-2">
              <Link href="/sop/import" className={ui.btnPrimary}>
                Import from Word
              </Link>
              <Link href="/sop/edit" className={ui.btnSecondary}>
                Edit draft
              </Link>
            </span>
          )}
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const [toc, docRow] = await Promise.all([loadToc(version.id), supabase.from("sop_documents").select("title, original_name").eq("id", documentId).maybeSingle()]);
  const title = (docRow.data as { title?: string } | null)?.title ?? "Standard Operating Procedures";
  const hasOriginal = !!(docRow.data as { original_name?: string | null } | null)?.original_name;
  const hits = q ? searchSections(await loadVersionTexts(version.id), q) : null;
  const wanted = sp.s && toc.some((t) => t.id === sp.s) ? sp.s : toc[0]?.id;
  const section = !hits && wanted ? await loadVersionSection(version.id, wanted) : null;
  const unread = showReadBanner(status) && status.versionId === version.id;

  const top = (
    <>
      <div className="sop-noprint flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-sand-500">
            Version {version.number}, published {fmtDay(version.published_at)}. What changed: {version.note}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/sop/pdf" className={`${ui.btnSecondary} ${ui.btnSm}`}>
            <Icon name="fileText" className="h-4 w-4" />
            Download PDF
          </a>
          {hasOriginal && (
            <a href="/sop/original" className={`${ui.btnSecondary} ${ui.btnSm}`}>
              <Icon name="inbox" className="h-4 w-4" />
              Original Word file
            </a>
          )}
        </div>
      </div>
      {unread && status.versionId && status.version != null && (
        <div className="sop-noprint flex flex-wrap items-center gap-3 rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-gold-800">
          <span className="font-semibold">New SOP version {status.version} - please read.</span>
          <span className="text-gold-800/80">When you have read it, tell us:</span>
          <span className="ml-auto">
            <AckButton versionId={status.versionId} version={status.version} />
          </span>
        </div>
      )}
    </>
  );

  return <SopReader basePath="/sop" toc={toc} section={section} q={q} hits={hits} versionLabel={`Version ${version.number}, ${fmtDay(version.published_at)}`} top={top} />;
}
