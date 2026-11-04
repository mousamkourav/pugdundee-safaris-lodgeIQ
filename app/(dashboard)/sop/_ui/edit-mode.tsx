"use client";

// The SOP draft editor (super admin): one section at a time, rich text (TipTap), autosaved a
// moment after typing stops. Staff keep reading the last PUBLISHED version until Publish.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
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
import { PROSE } from "../_ui/content";
import { saveSection, addSection, moveSection, deleteSection, createImageUpload } from "../admin-actions";

type Item = { id: string; title: string };

const EDITOR_CSS =
  ".sop-editor .ProseMirror{min-height:55vh;outline:none}.sop-editor .ProseMirror table{table-layout:fixed}.sop-editor .ProseMirror .selectedCell{background:var(--color-sand-100)}.sop-editor .ProseMirror img.ProseMirror-selectednode{outline:2px solid var(--color-gold-500)}";

export function SopEditor({ sections, current }: { sections: Item[]; current: { id: string; title: string; body: Doc } }) {
  const router = useRouter();
  const [title, setTitle] = useState(current.title);
  const [state, setState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const dirty = useRef(false);

  const save = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || !dirty.current) return;
    dirty.current = false;
    setState("saving");
    const r = await saveSection({ id: current.id, body: ed.getJSON() });
    if ("error" in r) {
      dirty.current = true;
      setState("error");
      setMessage(r.error);
    } else {
      setState(dirty.current ? "dirty" : "saved");
      setMessage(null);
      setSavedAt(r.savedAt);
    }
  }, [current.id]);

  const schedule = useCallback(() => {
    dirty.current = true;
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 1500);
  }, [save]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] }, code: false, codeBlock: false, link: { openOnClick: false, autolink: true, defaultProtocol: "https" } }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ inline: false }),
    ],
    content: current.body,
    editorProps: { attributes: { class: PROSE, "aria-label": "Section text" } },
    onUpdate: () => schedule(),
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // leaving the section: save what is left; warn when closing the tab with unsaved text
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
      void save();
    };
  }, [save]);

  const saveTitle = () => {
    const t = title.trim();
    if (!t || t === current.title) return;
    start(async () => {
      const r = await saveSection({ id: current.id, title: t });
      if ("error" in r) setMessage(r.error);
      else router.refresh();
    });
  };

  const act = (fn: () => Promise<{ ok: true; id?: string } | { error: string }>, after?: (id?: string) => void) =>
    start(async () => {
      await save();
      const r = await fn();
      if ("error" in r) setMessage(r.error);
      else {
        setMessage(null);
        if (after) after(r.id);
        else router.refresh();
      }
    });

  const at = sections.findIndex((s) => s.id === current.id);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <style>{EDITOR_CSS}</style>
      {/* sections of the draft */}
      <div className="space-y-3">
        <div className={`${ui.card} max-h-[60vh] overflow-y-auto p-2 lg:max-h-[calc(100vh-220px)]`}>
          <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-sand-500">Sections ({sections.length})</p>
          <ol className="space-y-0.5">
            {sections.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sop/edit?s=${s.id}`}
                  className={`block rounded-lg px-2 py-1.5 text-sm leading-snug ${s.id === current.id ? "bg-olive-600 font-semibold text-white" : "text-sand-700 hover:bg-sand-100"}`}
                >
                  {s.title}
                </Link>
              </li>
            ))}
          </ol>
        </div>
        <AddSection disabled={pending} onAdd={(t) => act(() => addSection({ title: t, afterId: current.id }), (id) => router.push(`/sop/edit?s=${id}`))} />
      </div>

      {/* the section */}
      <div className={`${ui.card} min-w-0 p-4 sm:p-6`}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className={ui.label}>Section title</span>
            <input className={ui.input} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && saveTitle()} />
          </label>
          <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={pending || at <= 0} onClick={() => act(() => moveSection(current.id, "up"))} aria-label="Move section up" title="Move up">
            Up
          </button>
          <button type="button" className={`${ui.btnSecondary} ${ui.btnSm}`} disabled={pending || at >= sections.length - 1} onClick={() => act(() => moveSection(current.id, "down"))} aria-label="Move section down" title="Move down">
            Down
          </button>
          <button
            type="button"
            className={`${ui.btnDangerOutline} ${ui.btnSm}`}
            disabled={pending || sections.length <= 1}
            onClick={() => {
              if (!confirm(`Delete the section "${current.title}" from the draft? Published versions keep it.`)) return;
              const next = sections[at + 1] ?? sections[at - 1];
              act(() => deleteSection(current.id), () => router.push(`/sop/edit${next ? `?s=${next.id}` : ""}`));
            }}
          >
            <Icon name="trash" className="h-4 w-4" />
            Delete
          </button>
        </div>

        <div className="sticky top-16 z-10 -mx-1 mt-4 flex flex-wrap gap-1 border-y border-sand-200 bg-white/95 px-1 py-2 backdrop-blur">
          {editor && <Toolbar editor={editor} onError={setMessage} />}
        </div>

        <div className="sop-editor mt-4">
          <EditorContent editor={editor} />
        </div>

        <p className="mt-4 text-xs text-sand-500" aria-live="polite">
          {state === "saving" ? "Saving..." : state === "dirty" ? "Changes not saved yet..." : state === "error" ? "Not saved." : savedAt ? `Draft saved at ${new Date(savedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : "Draft. Staff see the last published version until you publish."}
        </p>
        {message && <p className={`${ui.alertError} mt-2`}>{message}</p>}
      </div>
    </div>
  );
}

function AddSection({ onAdd, disabled }: { onAdd: (title: string) => void; disabled: boolean }) {
  const [t, setT] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (t.trim()) onAdd(t.trim());
        setT("");
      }}
    >
      <input className={ui.inputSm} placeholder="New section title" value={t} onChange={(e) => setT(e.target.value)} maxLength={200} />
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
