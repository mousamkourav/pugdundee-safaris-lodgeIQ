// SOP module: shared types. The body of a section is editor JSON (TipTap / ProseMirror shape):
// the editor reads and writes it, the read view and the PDF render it, the server cleans it
// (lib/sop/content.ts, sanitizeDoc) before it is saved.

export type MarkType = "bold" | "italic" | "underline" | "strike" | "link";
export interface Mark {
  type: MarkType;
  attrs?: { href: string };
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Mark[];
}

export interface Doc {
  type: "doc";
  content: PMNode[];
}

// A section as the editor and the import hand it to the server.
export interface SectionInput {
  id?: string;
  title: string;
  body: Doc;
}

// A section of a published version (sop_version_sections), or of the draft (sop_sections).
export interface SectionText {
  id: string; // the section's id: the same across versions, so "what changed" can follow it
  title: string;
  text: string;
}

export const EMPTY_DOC: Doc = { type: "doc", content: [{ type: "paragraph" }] };
