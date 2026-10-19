"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { MEDIA_BUCKET } from "@/lib/sales/master/types";
import { CATEGORY_LABEL, IMAGE_EXT, MEDIA_LIMIT, PHOTO_CATEGORIES, planPhoto, sourceRef, type PhotoCategory } from "@/lib/sales/media-import";
import { compressPhoto } from "@/lib/sales/compress-photo";
import { importMediaBatch, type ImportedPhoto } from "@/app/(dashboard)/sales/admin/media-actions";

export interface ImporterGallery {
  key: string; // "owner|ownerId"
  owner: "property" | "room_category" | "brand";
  ownerId: string | null;
  label: string;
  existing: number;
}

interface Entry {
  file: File;
  path: string;
  ref: string;
  dup: boolean;
}
interface Group {
  key: string;
  label: string;
  dest: string; // gallery key, "" = skip
  category: PhotoCategory;
  idx: number[];
  open: boolean;
}

const AUTO_SELECT_UP_TO = 12; // bigger folders start unticked, so you choose the best
const WORKERS = 2;
const BATCH = 5;
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// Read every file inside dropped folders (Chrome and Edge give folders as entries).
async function readDropped(items: DataTransferItemList): Promise<{ file: File; path: string }[]> {
  const out: { file: File; path: string }[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: entry.fullPath.replace(/^\//, "") });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  const roots = Array.from(items).map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  for (const r of roots) await walk(r);
  return out;
}

function Thumbs({ entries, idx, selected, toggle }: { entries: Entry[]; idx: number[]; selected: Set<number>; toggle: (i: number) => void }) {
  const [limit, setLimit] = useState(120);
  const shown = idx.slice(0, limit);
  const urls = useMemo(() => shown.map((i) => URL.createObjectURL(entries[i].file)), [shown, entries]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <div className="border-t border-sand-100 p-3">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8">
        {shown.map((i, k) => {
          const e = entries[i];
          const on = selected.has(i);
          return (
            <button
              key={i}
              type="button"
              disabled={e.dup}
              onClick={() => toggle(i)}
              className={`relative aspect-[4/3] overflow-hidden rounded-md border-2 ${e.dup ? "cursor-not-allowed border-sand-200 opacity-40" : on ? "border-olive-600" : "border-transparent hover:border-sand-300"}`}
              title={e.dup ? `${e.path} (already imported)` : e.path}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a file on this computer */}
              <img src={urls[k]} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              {on && (
                <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-olive-600 text-white">
                  <Icon name="check" className="h-3 w-3" />
                </span>
              )}
              {e.dup && <span className="absolute inset-x-0 bottom-0 bg-black/60 px-1 text-[10px] text-white">already in</span>}
            </button>
          );
        })}
      </div>
      {idx.length > limit && (
        <button type="button" className={`${ui.btnGhost} ${ui.btnSm} mt-2`} onClick={() => setLimit((l) => l + 120)}>
          Show {Math.min(120, idx.length - limit)} more ({idx.length - limit} not shown)
        </button>
      )}
    </div>
  );
}

export function PhotoImporter({
  lodges,
  rooms,
  galleries,
  knownRefs,
  usage,
}: {
  lodges: { id: string; name: string }[];
  rooms: { id: string; property_id: string; name: string }[];
  galleries: ImporterGallery[];
  knownRefs: string[];
  usage: { photos: number; mb: number };
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [unsupported, setUnsupported] = useState(0);
  const [reading, setReading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState<"pick" | "running" | "done">("pick");
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "", inserted: 0, skipped: 0, failed: [] as string[], bytes: 0 });

  const known = useMemo(() => new Set(knownRefs), [knownRefs]);
  const galleryByKey = useMemo(() => new Map(galleries.map((g) => [g.key, g])), [galleries]);

  // ---- add files (folder picker or drag and drop)
  function addFiles(list: { file: File; path: string }[]) {
    let bad = 0;
    const nextEntries = [...entries];
    const nextGroups = groups.map((g) => ({ ...g, idx: [...g.idx] }));
    const nextSelected = new Set(selected);
    const seen = new Set(entries.map((e) => e.ref));
    const touched = new Set<string>();
    for (const { file, path } of list) {
      if (!IMAGE_EXT.test(path)) {
        if (!/(^|\/)\.|\.(ini|db|txt|pdf|docx?|xlsx?)$/i.test(path)) bad++;
        continue;
      }
      const ref = sourceRef(path, file.size);
      if (seen.has(ref)) continue;
      seen.add(ref);
      const plan = planPhoto(path, file.size, lodges, rooms);
      const i = nextEntries.push({ file, path, ref, dup: known.has(ref) }) - 1;
      let g = nextGroups.find((x) => x.key === plan.groupKey);
      if (!g) {
        g = { key: plan.groupKey, label: plan.groupLabel, dest: plan.dest ? `${plan.dest.owner}|${plan.dest.ownerId ?? ""}` : "", category: plan.category, idx: [], open: false };
        nextGroups.push(g);
      }
      g.idx.push(i);
      touched.add(g.key);
    }
    // Small folders that were recognised start ticked; big ones open so you choose.
    for (const g of nextGroups) {
      if (!touched.has(g.key) || !g.dest) continue;
      const fresh = g.idx.filter((i) => !nextEntries[i].dup);
      if (fresh.length <= AUTO_SELECT_UP_TO) fresh.forEach((i) => nextSelected.add(i));
      else g.open = true;
    }
    nextGroups.sort((a, b) => (a.dest ? 0 : 1) - (b.dest ? 0 : 1) || a.label.localeCompare(b.label));
    setEntries(nextEntries);
    setGroups(nextGroups);
    setSelected(nextSelected);
    setUnsupported((u) => u + bad);
  }

  // ---- how full each gallery would be
  const plannedPerGallery = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of groups) {
      if (!g.dest) continue;
      const n = g.idx.filter((i) => selected.has(i)).length;
      if (n) m.set(g.dest, (m.get(g.dest) ?? 0) + n);
    }
    return m;
  }, [groups, selected]);
  const overLimit = [...plannedPerGallery.entries()]
    .map(([key, n]) => {
      const g = galleryByKey.get(key);
      const limit = g ? MEDIA_LIMIT[g.owner] : 0;
      return g && g.existing + n > limit ? `${g.label}: ${g.existing} + ${n} selected, but it holds ${limit}. Untick ${g.existing + n - limit}.` : null;
    })
    .filter((x): x is string => !!x);
  const totalSelected = [...plannedPerGallery.values()].reduce((a, b) => a + b, 0);

  const setGroup = (key: string, patch: Partial<Group>) => setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const toggle = (i: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const selectGroup = (g: Group, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const i of g.idx) {
        if (entries[i].dup) continue;
        if (on) n.add(i);
        else n.delete(i);
      }
      return n;
    });

  // ---- run the import
  async function start() {
    const queue: { e: Entry; gallery: ImporterGallery; category: PhotoCategory }[] = [];
    for (const g of groups) {
      const gallery = galleryByKey.get(g.dest);
      if (!gallery) continue;
      for (const i of g.idx) if (selected.has(i) && !entries[i].dup) queue.push({ e: entries[i], gallery, category: g.category });
    }
    if (!queue.length) return;
    cancelRef.current = false;
    setPhase("running");
    setProgress({ done: 0, total: queue.length, current: "", inserted: 0, skipped: 0, failed: [], bytes: 0 });

    const bucket = createClient().storage.from(MEDIA_BUCKET);
    let pending: ImportedPhoto[] = [];
    const failed: string[] = [];
    let inserted = 0;
    let skipped = 0;
    let done = 0;
    let bytes = 0;

    const flush = async () => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      try {
        const res = await importMediaBatch(batch);
        if (res.error) {
          failed.push(res.error);
          await bucket.remove(batch.map((b) => b.path)); // no orphan files
        } else {
          inserted += res.inserted ?? 0;
          skipped += res.skipped ?? 0;
        }
      } catch {
        failed.push("The connection was lost while saving. Run the import again; photos already in are skipped.");
        await bucket.remove(batch.map((b) => b.path)).catch(() => undefined);
      }
    };

    let next = 0;
    const worker = async () => {
      while (next < queue.length && !cancelRef.current) {
        const { e, gallery, category } = queue[next++];
        setProgress((p) => ({ ...p, current: e.path }));
        try {
          const blob = await compressPhoto(e.file);
          const ext = blob.type === "image/webp" ? "webp" : "jpg";
          const path = `${gallery.owner}/${gallery.ownerId ?? "brand"}/${newId()}.${ext}`;
          const { error } = await bucket.upload(path, blob, { contentType: blob.type, upsert: false });
          if (error) throw new Error(error.message);
          bytes += blob.size;
          pending.push({ owner: gallery.owner, ownerId: gallery.ownerId, path, category, source_ref: e.ref, bytes: blob.size });
          if (pending.length >= BATCH) await flush();
        } catch (err) {
          failed.push(`${e.path}: ${err instanceof Error ? err.message : "could not be imported"}`);
        }
        done++;
        setProgress((p) => ({ ...p, done, inserted, skipped, failed: [...failed], bytes }));
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    await flush();
    setProgress((p) => ({ ...p, done, inserted, skipped, failed: [...failed], bytes, current: "" }));
    setPhase("done");
    router.refresh();
  }

  const destOptions = (
    <>
      <option value="">Do not import</option>
      <option value="brand|">Brand photos</option>
      <optgroup label="Lodges">
        {galleries.filter((g) => g.owner === "property").map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
      </optgroup>
      <optgroup label="Rooms">
        {galleries.filter((g) => g.owner === "room_category").map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
      </optgroup>
    </>
  );

  // =====================================================================
  if (phase !== "pick") {
    const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    return (
      <div className={`${ui.card} space-y-4 p-5`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg">{phase === "running" ? "Importing photos..." : "Import finished"}</h2>
          <span className="tabular text-sm text-sand-600">{progress.done} of {progress.total}</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-sand-100">
          <div className="h-full rounded-full bg-olive-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
        {phase === "running" && (
          <>
            <p className="truncate text-xs text-sand-500">Compressing and uploading: {progress.current || "..."}</p>
            <p className="text-xs text-sand-500">Keep this tab open. You can stop at any time; anything already imported stays, and running the import again skips it.</p>
            <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => (cancelRef.current = true)}>
              Stop after the current photos
            </button>
          </>
        )}
        {phase === "done" && (
          <>
            <p className={progress.failed.length ? ui.alertWarning : ui.alertSuccess}>
              {progress.inserted} photo{progress.inserted === 1 ? "" : "s"} imported ({Math.round((progress.bytes / 1024 / 1024) * 10) / 10} MB in total)
              {progress.skipped ? `, ${progress.skipped} already there` : ""}
              {progress.failed.length ? `, ${progress.failed.length} problem${progress.failed.length === 1 ? "" : "s"}` : ""}.
            </p>
            {progress.failed.length > 0 && (
              <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-error">{progress.failed.map((f, i) => <li key={i}>{f}</li>)}</ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Link href="/sales/admin/properties" className={`${ui.btnSecondary} ${ui.btnSm}`}>Open lodges</Link>
              <Link href="/sales/admin/brand-photos" className={`${ui.btnSecondary} ${ui.btnSm}`}>Open brand photos</Link>
              <button
                type="button"
                className={`${ui.btnPrimary} ${ui.btnSm}`}
                onClick={() => {
                  setEntries([]);
                  setGroups([]);
                  setSelected(new Set());
                  setUnsupported(0);
                  setPhase("pick");
                }}
              >
                Import more
              </button>
            </div>
            <p className="text-xs text-sand-500">Set the cover photo and order in each lodge&apos;s gallery. The first photo imported into an empty gallery becomes its cover.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_260px]">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOver(false);
            setReading(true);
            try {
              addFiles(await readDropped(e.dataTransfer.items));
            } finally {
              setReading(false);
            }
          }}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition ${dragOver ? "border-olive-600 bg-olive-50" : "border-sand-300 bg-white"}`}
        >
          <Icon name="image" className="h-8 w-8 text-sand-400" />
          <p className="text-sm font-semibold text-olive-800">{reading ? "Reading folders..." : "Drag lodge or theme folders here"}</p>
          <p className="text-xs text-sand-500">For example A - Kings Lodge @ Bandhavgarh, or BIRDS IMAGES, or several at once</p>
          <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} onClick={() => inputRef.current?.click()} disabled={reading}>
            Or choose a folder
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            // folder picker (Chrome, Edge, Firefox, Safari)
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              addFiles(files.map((file) => ({ file, path: (file as File & { webkitRelativePath: string }).webkitRelativePath || file.name })));
              e.target.value = "";
            }}
          />
        </div>
        <div className={`${ui.card} space-y-1 p-4 text-sm`}>
          <p className="eyebrow">Sales photos now</p>
          <p className="tabular font-display text-xl font-semibold text-olive-800">{usage.photos} photos</p>
          <p className="text-xs text-sand-500">{usage.mb} MB of the free 1 GB (shared with trip-report photos)</p>
          <p className="pt-2 text-xs text-sand-500">Each photo is stored at about 0.2 to 0.35 MB. 300 photos is roughly 75 MB.</p>
        </div>
      </div>

      {unsupported > 0 && (
        <p className={ui.alertWarning}>
          {unsupported} file{unsupported === 1 ? " was" : "s were"} skipped because {unsupported === 1 ? "it is not" : "they are not"} JPG, PNG or WebP (for example camera RAW .NEF or iPhone .HEIC). Export them as JPG first if you need them.
        </p>
      )}

      {groups.length > 0 && (
        <>
          <div className="space-y-2">
            {groups.map((g) => {
              const fresh = g.idx.filter((i) => !entries[i].dup);
              const sel = g.idx.filter((i) => selected.has(i)).length;
              const gallery = galleryByKey.get(g.dest);
              return (
                <div key={g.key} className={`rounded-xl border bg-white ${g.dest ? "border-sand-200" : "border-dashed border-sand-300 opacity-90"}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                    <button type="button" onClick={() => setGroup(g.key, { open: !g.open })} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={g.open}>
                      <Icon name="chevronLeft" className={`h-4 w-4 shrink-0 text-sand-500 transition ${g.open ? "rotate-90" : "-rotate-90"}`} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-olive-800" title={g.label}>{g.label}</span>
                        <span className="block text-xs text-sand-500">
                          {g.idx.length} photo{g.idx.length === 1 ? "" : "s"}
                          {g.idx.length !== fresh.length ? `, ${g.idx.length - fresh.length} already in` : ""}
                          {g.dest ? ` \u00b7 ${sel} selected` : ""}
                          {g.dest && fresh.length > AUTO_SELECT_UP_TO && sel === 0 ? " \u00b7 open to choose the best ones" : ""}
                        </span>
                      </span>
                    </button>
                    <select
                      className="max-w-[16rem] rounded-md border border-sand-300 bg-white px-2 py-1.5 text-xs"
                      value={g.dest}
                      onChange={(e) => setGroup(g.key, { dest: e.target.value })}
                      aria-label="Import into"
                    >
                      {destOptions}
                    </select>
                    <select
                      className="rounded-md border border-sand-300 bg-white px-2 py-1.5 text-xs"
                      value={g.category}
                      disabled={!g.dest}
                      onChange={(e) => setGroup(g.key, { category: e.target.value as PhotoCategory })}
                      aria-label="Category"
                    >
                      {PHOTO_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                    </select>
                    {g.dest && (
                      <span className="flex gap-1">
                        <button type="button" className={`${ui.btnGhost} ${ui.btnSm} !min-h-7 !px-2`} onClick={() => selectGroup(g, true)}>All</button>
                        <button type="button" className={`${ui.btnGhost} ${ui.btnSm} !min-h-7 !px-2`} onClick={() => selectGroup(g, false)}>None</button>
                      </span>
                    )}
                  </div>
                  {gallery && g.open && (
                    <p className="px-3 pb-1 text-[11px] text-sand-500">
                      {gallery.label} has {gallery.existing} of {MEDIA_LIMIT[gallery.owner]} photos. Click photos to tick or untick them.
                    </p>
                  )}
                  {g.open && <Thumbs entries={entries} idx={g.idx} selected={selected} toggle={toggle} />}
                </div>
              );
            })}
          </div>

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand-200 bg-white/95 px-4 py-3 shadow-card backdrop-blur">
            <div className="text-sm">
              <b className="text-olive-800">{totalSelected}</b> photo{totalSelected === 1 ? "" : "s"} selected for {plannedPerGallery.size} galler{plannedPerGallery.size === 1 ? "y" : "ies"}
              {overLimit.length > 0 && <p className="text-xs font-medium text-error">{overLimit[0]}</p>}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className={`${ui.btnSecondary} ${ui.btnSm}`}
                onClick={() => {
                  setEntries([]);
                  setGroups([]);
                  setSelected(new Set());
                  setUnsupported(0);
                }}
              >
                Clear
              </button>
              <button type="button" className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={!totalSelected || overLimit.length > 0} onClick={start}>
                Import {totalSelected || ""} photo{totalSelected === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
