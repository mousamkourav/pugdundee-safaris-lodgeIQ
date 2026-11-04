import Link from "next/link";
import { requireSopViewer, loadLiveVersion, loadToc, loadVersionSection, loadVersionTexts, loadWorkingList, fmtDay } from "@/lib/sop/server";
import { showReadBanner, sqlOutdated } from "@/lib/sop/access";
import { RUN_SQL } from "@/lib/sop/errors";
import { searchSections } from "@/lib/sop/content";
import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/icons";
import { ui } from "@/components/ui";
import type { Doc } from "@/lib/sop/types";
import { SopReader } from "./_ui/reader";
import { AckButton } from "./_ui/ack-button";
// the editor and the importer load only when the super admin opens them (see _ui/lazy.tsx)
import { SopEditMode, Importer } from "./_ui/lazy";

export const metadata = { title: "SOP" };

// The SOP, one page for everyone: contents + sections, search, Download PDF.
// The super admin also edits here in place (?edit=1), imports a Word file (?import=1) and
// exports the PDF; every change goes live at once. Staff never get the edit or import view.
export default async function SopPage({ searchParams }: { searchParams: Promise<{ s?: string; q?: string; edit?: string; import?: string }> }) {
  const { status, documentId } = await requireSopViewer();
  const sp = await searchParams;
  const isEditor = status.isEditor; // from the database (sop_is_editor), never from the address
  const mode = isEditor && sp.import ? "import" : isEditor && sp.edit ? "edit" : "read";
  const q = (sp.q ?? "").trim().slice(0, 100);
  // an imported SOP never published becomes version 1 now (once), so the SOP always shows
  const version = await loadLiveVersion(documentId);
  const supabase = await createClient();
  const { data: docRow } = await supabase.from("sop_documents").select("title, original_name").eq("id", documentId).maybeSingle();
  const title = (docRow as { title?: string } | null)?.title ?? "Standard Operating Procedures";
  const hasOriginal = !!(docRow as { original_name?: string | null } | null)?.original_name;
  // the database has an older sop_module.sql: say so before the super admin tries a change
  const outdated = isEditor && sqlOutdated(status) ? (
    <p className={ui.alertWarning} role="alert">
      The database has an older version of the SOP functions, so saving, importing and restoring are switched off. {RUN_SQL}
    </p>
  ) : null;

  // ---- import (super admin)
  if (mode === "import" || (isEditor && !version)) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        {outdated}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl">Import the SOP from Word</h1>
            <p className="mt-1 text-sm text-sand-500">
              Split into sections at the codes (A-1 ... F-7) and at &quot;Training&quot;; slide footers and empty lines removed; lists, tables and pictures kept. Check the
              preview, then make it live. Old versions stay in the history.
            </p>
          </div>
          {version && (
            <Link href="/sop" className={ui.btnSecondary}>
              Cancel
            </Link>
          )}
        </div>
        <Importer hasContent={!!version} />
      </div>
    );
  }

  if (!version) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl">{title}</h1>
        <div className={ui.empty}>The SOP is being prepared. Please check again soon.</div>
      </div>
    );
  }

  // ---- edit in place (super admin)
  if (mode === "edit") {
    const list = await loadWorkingList(documentId);
    const id = list.some((s) => s.id === sp.s) ? sp.s! : list[0]?.id;
    const { data: row } = id ? await supabase.from("sop_sections").select("id, title, body_json").eq("id", id).maybeSingle() : { data: null };
    const current = row as { id: string; title: string; body_json: Doc } | null;
    return (
      <div className="space-y-4">
        {outdated}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl">Editing: {title}</h1>
            <p className="mt-1 text-sm text-sand-500">Save makes a section live at once. Staff see version {version.number} now.</p>
          </div>
        </div>
        {current ? (
          <SopEditMode key={current.id} sections={list} current={{ id: current.id, title: current.title, body: current.body_json }} />
        ) : (
          <div className={ui.empty}>No sections yet. Import the Word file first.</div>
        )}
      </div>
    );
  }

  // ---- read (everyone)
  const toc = await loadToc(version.id);
  const hits = q ? searchSections(await loadVersionTexts(version.id), q) : null;
  const wanted = sp.s && toc.some((t) => t.id === sp.s) ? sp.s : toc[0]?.id;
  const section = !hits && wanted ? await loadVersionSection(version.id, wanted) : null;
  const banner = showReadBanner(status) && status.readVersionId && status.readVersion != null;

  const top = (
    <>
      {outdated}
      <div className="sop-noprint flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl">{title}</h1>
          <p className="mt-1 text-sm text-sand-500">Updated {fmtDay(version.published_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isEditor && (
            <>
              <Link href={`/sop?edit=1${section ? `&s=${encodeURIComponent(section.id)}` : ""}`} className={`${ui.btnPrimary} ${ui.btnSm}`}>
                <Icon name="edit" className="h-4 w-4" />
                Edit
              </Link>
              <Link href="/sop?import=1" className={`${ui.btnSecondary} ${ui.btnSm}`}>
                <Icon name="inbox" className="h-4 w-4" />
                Import SOP
              </Link>
            </>
          )}
          <a href="/sop/pdf" className={`${ui.btnSecondary} ${ui.btnSm}`}>
            <Icon name="fileText" className="h-4 w-4" />
            {isEditor ? "Export SOP (PDF)" : "Download PDF"}
          </a>
          {hasOriginal && (
            <a href="/sop/original" className={`${ui.btnSecondary} ${ui.btnSm}`}>
              Original Word file
            </a>
          )}
        </div>
      </div>
      {banner && (
        <div className="sop-noprint flex flex-wrap items-center gap-3 rounded-xl border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-gold-800">
          <span className="font-semibold">The SOP has been updated - please read it.</span>
          <span className="ml-auto">
            <AckButton versionId={status.readVersionId!} version={status.readVersion!} />
          </span>
        </div>
      )}
    </>
  );

  return <SopReader basePath="/sop" toc={toc} section={section} q={q} hits={hits} versionLabel={`Updated ${fmtDay(version.published_at)}`} top={top} />;
}
