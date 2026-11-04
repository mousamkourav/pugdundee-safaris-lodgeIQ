"use client";

// Editing the SOP in place (super admin), like a simple CMS: pick a section, change it, Save.
// Save goes live at once (a new version is kept in the background). Sections are added, moved
// and deleted here too; each of those goes live at once as well.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Icon } from "@/components/icons";
import { ui } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Doc } from "@/lib/sop/types";
import { PROSE } from "./content";
import { saveSection, addSection, moveSection, deleteSection, createImageUpload } from "../admin-actions";

type Item = { id: string; title: string };

const EDITOR_CSS =
  ".sop-editor .ProseMirror{min-height:45vh;outline:none}.sop-editor .ProseMirror table{table-layout:fixed}.sop-editor .ProseMirror .selectedCell{background:var(--color-sand-100)}.sop-editor .ProseMirror img.ProseMirror-selectednode{outline:2px solid var(--color-gold-500)}";

const editHref = (id: string) => `/sop?edit=1&s=${encodeURIComponent(id)}`;

export function SopEditMode({ sections, current }: { sections: Item[]; current: { id: string; title: string; body: Doc } }) {
  const router = useRouter();
  const [title, setTitle] = useState(current.title);
  const [ask, setAsk] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty || title.trim() !== current.title;
  }, [dirty, title, current.title]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, code: false, codeBlock: false, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ inline: false }),
    ],
    content: current.body,
    editorProps: { attributes: { class: PROSE, "aria-label": "Section text" } },
    onUpdate: () => setDirty(true),
  });

  // closing the tab with unsaved changes: the browser asks first
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  // leaving for another section or the read view: ask when there are unsaved changes
  const leave = (e: React.MouseEvent) => {
    if (dirtyRef.current && !confirm("You have unsaved changes in this section. Leave without saving?")) e.preventDefault();
  };

  const save = () =>
    start(async () => {
      if (!editor) return;
      const r = await saveSection({ id: current.id, title, body: editor.getJSON(), ask });
      if ("error" in r) return setMsg({ ok: false, text: r.error });
      setDirty(false);
      dirtyRef.current = false;
      setMsg({ ok: true, text: `Saved. It is live now (version ${r.version})${ask ? "; staff are asked to read it" : ""}.` });
      setAsk(false);
      router.refresh();
    });

  const act = (fn: () => Promise<{ ok: true; id?: string } | { error: string }>, after?: (id?: string) => void) => {
    if (dirtyRef.current && !confirm("This section has unsaved changes; they will be lost. Continue?")) return;
    start(async () => {
      const r = await fn();
      if ("error" in r) return setMsg({ ok: false, text: r.error });
      setMsg(null);
      if (after) after(r.id);
      else router.refresh();
    });
  };

  const at = sections.findIndex((s) => s.id === current.id);

  const manager = (
    <div className="space-y-3">
      <ol className="space-y-0.5">
        {sections.map((s, i) => {
          const active = s.id === current.id;
          return (
            <li key={s.id} className={`flex items-center gap-1 rounded-lg ${active ? "bg-olive-600" : "hover:bg-sand-100"}`}>
              <Link href={editHref(s.id)} onClick={leave} className={`min-w-0 flex-1 px-2 py-1.5 text-sm leading-snug ${active ? "font-semibold text-white" : "text-sand-700"}`}>
                {s.title}
              </Link>
              {active && (
                <span className="flex shrink-0 gap-0.5 pr-1">
                  <button type="button" disabled={pending || i === 0} onClick={() => act(() => moveSection(s.id, "up"))} className="min-h-9 min-w-9 rounded text-white disabled:opacity-40" aria-label="Move section up" title="Move up">
                    &uarr;
                  </button>
                  <button type="button" disabled={pending || i === sections.length - 1} onClick={() => act(() => moveSection(s.id, "down"))} className="min-h-9 min-w-9 rounded text-white disabled:opacity-40" aria-label="Move section down" title="Move down">
                    &darr;
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <AddSection disabled={pending} onAdd={(t) => act(() => addSection({ title: t, afterId: current.id }), (id) => router.push(editHref(id!)))} />
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-6">
      <style>{EDITOR_CSS}</style>
      {/* sections: a side list on wide screens, folded on phones */}
      <details className={`${ui.card} p-3 lg:hidden`}>
        <summary className="cursor-pointer text-sm font-semibold text-olive-800">
          Sections ({sections.length}): {current.title}
        </summary>
        <div className="mt-3">{manager}</div>
      </details>
      <div className={`${ui.card} hidden max-h-[calc(100vh-200px)] overflow-y-auto p-2 lg:sticky lg:top-20 lg:block`}>
        <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-sand-500">Sections ({sections.length})</p>
        {manager}
      </div>

      <div className={`${ui.card} min-w-0 p-4 sm:p-6`}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 basis-60">
            <span className={ui.label}>Section title</span>
            <input className={ui.input} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <button
            type="button"
            className={`${ui.btnDangerOutline} ${ui.btnSm}`}
            disabled={pending || sections.length <= 1}
            onClick={() => {
              if (!confirm(`Delete the section "${current.title}"? Staff stop seeing it at once (old versions keep it).`)) return;
              const next = sections[at + 1] ?? sections[at - 1];
              dirtyRef.current = false;
              act(() => deleteSection(current.id), () => router.push(next ? editHref(next.id) : "/sop"));
            }}
          >
            <Icon name="trash" className="h-4 w-4" />
            Delete section
          </button>
        </div>

        <div className="sticky top-16 z-10 -mx-1 mt-4 flex flex-wrap gap-1 border-y border-sand-200 bg-white/95 px-1 py-2 backdrop-blur">
          {editor && <Toolbar editor={editor} onError={(t) => setMsg(t ? { ok: false, text: t } : null)} />}
        </div>

        <div className="sop-editor mt-4">
          <EditorContent editor={editor} />
        </div>

        <div className="sticky bottom-0 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-sand-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <label className="flex min-h-11 items-center gap-2 text-sm text-sand-700">
            <input type="checkbox" checked={ask} onChange={(e) => setAsk(e.target.checked)} className="h-4 w-4" />
            Ask staff to read this update
          </label>
          <span className="ml-auto flex gap-2">
            <Link href={`/sop?s=${encodeURIComponent(current.id)}`} onClick={leave} className={ui.btnSecondary}>
              Done
            </Link>
            <button type="button" className={ui.btnPrimary} disabled={pending || !editor || !title.trim()} onClick={save}>
              {pending ? "Saving..." : "Save"}
            </button>
          </span>
          {msg && (
            <p className={`${msg.ok ? ui.alertSuccess : ui.alertError} w-full`} aria-live="polite">
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function AddSection({ onAdd, disabled }: { onAdd: (title: string) => void; disabled: boolean }) {
  const [t, setT] = useState("");
  return (
    <form
      className="flex gap-2 px-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (t.trim()) onAdd(t.trim());
        setT("");
      }}
    >
      <input className={ui.inputSm} placeholder="New section title" value={t} onChange={(e) => setT(e.target.value)} maxLength={200} aria-label="New section title" />
      <button className={`${ui.btnPrimary} ${ui.btnSm}`} disabled={disabled || !t.trim()}>
        <Icon name="plus" className="h-4 w-4" />
        Add
      </button>
    </form>
  );
}

function Toolbar({ editor, onError }: { editor: Editor; onError: (m: string | null) => void }) {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    editor.on("selectionUpdate", f);
    editor.on("transaction", f);
    return () => {
      editor.off("selectionUpdate", f);
      editor.off("transaction", f);
    };
  }, [editor]);
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const c = () => editor.chain().focus();
  const B = ({ on, label, active, children, disabled }: { on: () => void; label: string; active?: boolean; children: React.ReactNode; disabled?: boolean }) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={on}
      className={`min-h-9 min-w-9 rounded-md px-2 text-sm font-medium transition disabled:opacity-40 ${active ? "bg-olive-600 text-white" : "text-sand-700 hover:bg-sand-100"}`}
    >
      {children}
    </button>
  );
  const inTable = editor.isActive("table");

  const addLink = () => {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = prompt("Link address (https://...). Leave empty to remove the link.", prev ?? "https://");
    if (url === null) return;
    if (!url.trim() || url.trim() === "https://") c().unsetLink().run();
    else if (/^(https?:\/\/|mailto:|tel:)\S+$/i.test(url.trim())) c().extendMarkRange("link").setLink({ href: url.trim() }).run();
    else onError("A link must start with https://, mailto: or tel:");
  };

  const upload = async (f: File) => {
    const ext = (f.name.split(".").pop() ?? "").toLowerCase();
    setUploading(true);
    onError(null);
    try {
      const r = await createImageUpload(ext, f.size);
      if ("error" in r) return onError(r.error);
      const { error } = await createClient().storage.from("sop-media").uploadToSignedUrl(r.path, r.token, f, { contentType: f.type });
      if (error) return onError(`The picture was not uploaded: ${error.message}`);
      c().setImage({ src: r.src, alt: f.name.replace(/\.[^.]+$/, "") }).run();
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <B label="Bold" active={editor.isActive("bold")} on={() => c().toggleBold().run()}>
        <b>B</b>
      </B>
      <B label="Italic" active={editor.isActive("italic")} on={() => c().toggleItalic().run()}>
        <i>I</i>
      </B>
      <B label="Underline" active={editor.isActive("underline")} on={() => c().toggleUnderline().run()}>
        <u>U</u>
      </B>
      <B label="Heading" active={editor.isActive("heading", { level: 3 })} on={() => c().toggleHeading({ level: 3 }).run()}>
        H
      </B>
      <B label="Small heading" active={editor.isActive("heading", { level: 4 })} on={() => c().toggleHeading({ level: 4 }).run()}>
        h
      </B>
      <B label="Bullet list" active={editor.isActive("bulletList")} on={() => c().toggleBulletList().run()}>
        &bull; List
      </B>
      <B label="Numbered list" active={editor.isActive("orderedList")} on={() => c().toggleOrderedList().run()}>
        1. List
      </B>
      <B label="Link" active={editor.isActive("link")} on={addLink}>
        Link
      </B>
      <B label="Insert table" on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} disabled={inTable}>
        Table
      </B>
      {inTable && (
        <>
          <B label="Add row below" on={() => c().addRowAfter().run()}>
            +Row
          </B>
          <B label="Add column right" on={() => c().addColumnAfter().run()}>
            +Col
          </B>
          <B label="Delete row" on={() => c().deleteRow().run()}>
            -Row
          </B>
          <B label="Delete column" on={() => c().deleteColumn().run()}>
            -Col
          </B>
          <B label="Delete table" on={() => c().deleteTable().run()}>
            No table
          </B>
        </>
      )}
      <B label="Insert picture" on={() => file.current?.click()} disabled={uploading}>
        {uploading ? "Uploading..." : "Picture"}
      </B>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <span className="mx-1 w-px self-stretch bg-sand-200" />
      <B label="Undo" on={() => c().undo().run()} disabled={!editor.can().undo()}>
        Undo
      </B>
      <B label="Redo" on={() => c().redo().run()} disabled={!editor.can().redo()}>
        Redo
      </B>
    </>
  );
}
