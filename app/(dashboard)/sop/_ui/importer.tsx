"use client";

// Import from Word (super admin). The file is read IN THE BROWSER (it is 120 MB; the server takes
// a few MB at most): unzip, read, clean, split into sections. The owner checks the preview and
// may move section breaks; then the sections and the pictures are uploaded straight to the
// private bucket and the server makes them the SOP, live at once (old versions stay in the
// history). The Word file itself is
// not stored (owner, 4 Nov 2026: 122 MB; staff download the PDF).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { readDocx, type Inflate } from "@/lib/sop/zip";
import { parseDocument, type Block } from "@/lib/sop/docx";
import { cleanBlocks, candidates, buildSections, type Cleaned, type Candidate } from "@/lib/sop/import";
import { SopContent } from "../_ui/content";
import { createImportUploads, commitImport } from "../admin-actions";

const inflate: Inflate = async (data) => {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const extOf = (target: string) => (target.split(".").pop() ?? "png").toLowerCase().replace("jpeg", "jpg");
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

type Parsed = { file: File; cleaned: Cleaned; cands: Candidate[]; media: Map<string, Uint8Array>; urls: Map<string, string> };

export function Importer({ hasContent }: { hasContent: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [splits, setSplits] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [showBreaks, setShowBreaks] = useState(false);
  const [ask, setAsk] = useState(true);

  const sections = useMemo(() => (parsed ? buildSections(parsed.cleaned, splits, (t) => parsed.urls.get(t) ?? null) : []), [parsed, splits]);
  const keptImages = useMemo(() => (parsed ? [...new Set(parsed.cleaned.blocks.filter((b): b is Extract<Block, { kind: "image" }> => b.kind === "image").map((b) => b.target))] : []), [parsed]);

  const read = async (file: File) => {
    setError(null);
    setParsed(null);
    setSplits({});
    if (!/\.docx$/i.test(file.name)) return setError("Choose a Word file (.docx).");
    if (typeof DecompressionStream === "undefined") return setError("This browser cannot read Word files. Please use a recent Chrome, Edge, Safari or Firefox.");
    try {
      setBusy(`Reading ${file.name} (${mb(file.size)}). A large file takes up to a minute...`);
      await new Promise((r) => setTimeout(r, 30)); // let the message show
      const parts = await readDocx(new Uint8Array(await file.arrayBuffer()), inflate);
      setBusy("Finding the sections...");
      await new Promise((r) => setTimeout(r, 30));
      const cleaned = cleanBlocks(parseDocument(parts.document, parts.rels, parts.numbering));
      const urls = new Map<string, string>();
      for (const b of cleaned.blocks) {
        if (b.kind !== "image" || urls.has(b.target)) continue;
        const bytes = parts.media.get(b.target);
        if (bytes) urls.set(b.target, URL.createObjectURL(new Blob([bytes as BlobPart], { type: MIME[extOf(b.target)] ?? "image/png" })));
      }
      setParsed({ file, cleaned, cands: candidates(cleaned.blocks), media: parts.media, urls });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be read.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!parsed) return;
    if (hasContent && !confirm("This replaces the whole SOP with the imported sections, live at once. Old versions stay in the history (Access & reading). Continue?")) return;
    setError(null);
    try {
      setBusy("Preparing the upload...");
      const exts = keptImages.map(extOf);
      const up = await createImportUploads({ imageExts: exts });
      if ("error" in up) return setError(up.error);
      const storage = createClient().storage.from("sop-media");

      // pictures
      const src = new Map<string, string>();
      for (let i = 0; i < keptImages.length; i++) {
        setBusy(`Uploading pictures (${i + 1} of ${keptImages.length})...`);
        const bytes = parsed.media.get(keptImages[i]);
        if (!bytes) continue;
        const u = up.images[i];
        const { error } = await storage.uploadToSignedUrl(u.path, u.token, new Blob([bytes as BlobPart], { type: MIME[exts[i]] ?? "image/png" }), { contentType: MIME[exts[i]] ?? "image/png" });
        if (error) return setError(`A picture could not be uploaded: ${error.message}`);
        src.set(keptImages[i], u.src);
      }

      // the sections, as a file (too big for a direct call)
      setBusy("Uploading the sections...");
      const final = buildSections(parsed.cleaned, splits, (t) => src.get(t) ?? null).map((s) => ({ title: s.title, body: s.body }));
      const json = new Blob([JSON.stringify(final)], { type: "application/json" });
      const j = await storage.uploadToSignedUrl(up.json.path, up.json.token, json, { contentType: "application/json" });
      if (j.error) return setError(`The sections could not be uploaded: ${j.error.message}`);

      setBusy("Making it live...");
      const s = parsed.cleaned.stats;
      const r = await commitImport({
        jsonPath: up.json.path,
        fileName: parsed.file.name,
        ask,
        detail: { footersRemoved: s.footers, emptyRemoved: s.empty, linesToCheck: s.garbled, picturesKept: s.imagesKept, picturesDropped: s.imagesDropped },
      });
      if ("error" in r) return setError(r.error);
      alert(`Imported ${r.sections} sections. The SOP is live (version ${r.version}).`);
      router.push("/sop");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The import did not finish.");
    } finally {
      setBusy(null);
    }
  };

  const s = parsed?.cleaned.stats;
  const warnings = sections.reduce((n, x) => n + x.warnings.length, 0);

  return (
    <div className="space-y-5">
      <div className={`${ui.card} p-4 sm:p-6`}>
        <label className="block">
          <span className={ui.label}>Word file (.docx)</span>
          <input
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void read(f);
            }}
            className="block w-full text-sm text-sand-700 file:mr-3 file:rounded-lg file:border-0 file:bg-olive-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
        </label>
        <p className="mt-2 text-xs text-sand-500">Nothing changes until you press &quot;Import and make live&quot; below.</p>
      </div>

      {busy && (
        <p className={ui.alertWarning} aria-live="polite">
          {busy}
        </p>
      )}
      {error && <p className={ui.alertError}>{error}</p>}

      {parsed && s && (
        <>
          <div className={`${ui.card} p-4 sm:p-6`}>
            <h2 className="text-lg">Preview: {sections.length} sections</h2>
            <ul className="mt-2 grid gap-1 text-sm text-sand-600 sm:grid-cols-2">
              <li>Slide footers removed: {s.footers}</li>
              <li>Empty lines removed: {s.empty}</li>
              <li>Slide numbers removed: {s.slideNumbers}</li>
              <li>Pictures kept: {s.imagesKept} (decorative left out: {s.imagesDropped})</li>
              <li>Tables: {sections.reduce((n, x) => n + x.counts.tables, 0)}</li>
              <li className={warnings ? "font-semibold text-warning" : ""}>Things to check: {warnings}</li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className={ui.btnPrimary} disabled={!!busy || !sections.length} onClick={() => void save()}>
                Import and make live
              </button>
              <label className="flex min-h-11 items-center gap-2 text-sm text-sand-700">
                <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} className="h-4 w-4" />
                Ask staff to read it
              </label>
              <button className={ui.btnSecondary} onClick={() => setShowBreaks((x) => !x)}>
                {showBreaks ? "Hide" : "Change"} section breaks
              </button>
            </div>
          </div>

          {showBreaks && (
            <div className={`${ui.card} p-4 sm:p-6`}>
              <h2 className="text-lg">Section breaks</h2>
              <p className="mt-1 text-sm text-sand-500">Ticked lines start a new section; the others stay headings inside the section before them.</p>
              <ul className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto text-sm">
                {parsed.cands.map((c) => {
                  const on = splits[c.index] ?? c.split;
                  return (
                    <li key={c.index}>
                      <label className="flex items-start gap-2 rounded px-1 py-1 hover:bg-sand-100">
                        <input type="checkbox" className="mt-1" checked={on} onChange={(e) => setSplits((x) => ({ ...x, [c.index]: e.target.checked }))} />
                        <span className={on ? "font-semibold text-olive-800" : "text-sand-600"}>{c.text}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <ol className="space-y-2">
            {sections.map((x, i) => (
              <li key={`${x.start}-${i}`} className={`${ui.card} p-3 sm:p-4`}>
                <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <span>
                    <span className="font-semibold text-olive-800">{x.title}</span>
                    <span className="block text-xs text-sand-500">
                      {x.counts.paragraphs} lines, {x.counts.lists} lists, {x.counts.tables} tables, {x.counts.images} pictures
                    </span>
                  </span>
                  <Icon name={open === i ? "x" : "arrowRight"} className="mt-1 h-4 w-4 shrink-0 text-sand-500" />
                </button>
                {x.warnings.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {x.warnings.map((w, k) => (
                      <li key={k} className={ui.alertWarning}>
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                {open === i && <SopContent doc={x.body} className="mt-3 border-t border-sand-200 pt-3" />}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
