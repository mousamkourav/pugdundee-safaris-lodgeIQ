// Test helper (run by plain.test.ts in its own Node process with the "react-server" condition,
// which React's server side needs): the editor's section JSON goes through a server action
// exactly like in the app (React's encodeReply in the browser -> decodeReply on the server),
// and the server cleans it (sanitizeDoc), as saveSection does. Prints one JSON line.
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Image from "@tiptap/extension-image";
import { Node } from "@tiptap/pm/model";
import { sanitizeDoc } from "../content";
import { toPlainJson, isPlainData } from "../plain";

/* eslint-disable @typescript-eslint/no-require-imports */
const client = require("next/dist/compiled/react-server-dom-webpack/client.edge");
const server = require("next/dist/compiled/react-server-dom-webpack/server.edge");
/* eslint-enable @typescript-eslint/no-require-imports */

// the same extensions as the editor (app/(dashboard)/sop/_ui/edit-mode.tsx)
const schema = getSchema([StarterKit.configure({ heading: { levels: [2, 3, 4] }, code: false, codeBlock: false }), TableKit, Image]);
const section = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Procedure:" }] },
    { type: "orderedList", attrs: { start: 1 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Call the guest a day prior." }] }] }] },
    { type: "paragraph", content: [{ type: "text", text: "by email", marks: [{ type: "link", attrs: { href: "mailto:reservation@pugdundeesafaris.com" } }] }] },
    { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "Radiator" }] }] }] }] },
  ],
};
// what editor.getJSON() returns: ProseMirror's own node JSON
const fromEditor = Node.fromJSON(schema, section).toJSON();

async function throughServerAction(body: unknown) {
  const body2 = await client.encodeReply({ id: "s1", title: "A-1", body }, { temporaryReferences: client.createTemporaryReferenceSet() });
  const got = await server.decodeReply(body2, {}, { temporaryReferences: server.createTemporaryReferenceSet() });
  try {
    const clean = sanitizeDoc(got.body);
    return { ok: true, firstListStart: clean.content.find((n) => n.type === "orderedList")?.attrs?.start ?? null, nodes: clean.content.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

(async () => {
  const raw = await throughServerAction(fromEditor);
  const plain = await throughServerAction(toPlainJson(fromEditor));
  console.log(JSON.stringify({ editorJsonIsPlain: isPlainData(fromEditor), plainIsPlain: isPlainData(toPlainJson(fromEditor)), raw, plain }));
})();
