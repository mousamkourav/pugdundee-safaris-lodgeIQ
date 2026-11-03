// Renders a section body (editor JSON) as React elements: no raw HTML is ever injected.
// Used by the read view, old versions and the import preview (server and client).
import type { ReactNode } from "react";
import type { Doc, PMNode } from "@/lib/sop/types";
import { highlightParts } from "@/lib/sop/content";

// Typography for SOP text (read view and editor share it).
export const PROSE =
  "text-[15px] leading-relaxed text-sand-700 [&_a]:text-olive-700 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:border-sand-300 [&_blockquote]:pl-4 [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-xl [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-olive-800 [&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:font-semibold [&_hr]:my-6 [&_hr]:border-sand-200 [&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_td]:border [&_td]:border-sand-200 [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:border-sand-200 [&_th]:bg-sand-100 [&_th]:p-2 [&_th]:text-left [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_mark]:rounded [&_mark]:bg-gold-200 [&_mark]:px-0.5 [&_mark]:text-sand-700";

const safeHref = (h: unknown) => (typeof h === "string" && /^(https?:\/\/|mailto:|tel:)/i.test(h) ? h : undefined);

function text(n: PMNode, words: string[], key: number): ReactNode {
  let out: ReactNode = highlightParts(n.text ?? "", words).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text));
  for (const m of n.marks ?? []) {
    if (m.type === "bold") out = <strong>{out}</strong>;
    else if (m.type === "italic") out = <em>{out}</em>;
    else if (m.type === "underline") out = <u>{out}</u>;
    else if (m.type === "strike") out = <s>{out}</s>;
    else if (m.type === "link") {
      const href = safeHref(m.attrs?.href);
      if (href)
        out = (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {out}
          </a>
        );
    }
  }
  return <span key={key}>{out}</span>;
}

function node(n: PMNode, words: string[], key: number, imageSrc?: (src: string) => string): ReactNode {
  const kids = () => (n.content ?? []).map((c, i) => node(c, words, i, imageSrc));
  switch (n.type) {
    case "text":
      return text(n, words, key);
    case "hardBreak":
      return <br key={key} />;
    case "horizontalRule":
      return <hr key={key} />;
    case "paragraph":
      return <p key={key}>{kids()}</p>;
    case "heading": {
      const level = Number(n.attrs?.level);
      return level === 2 ? <h2 key={key}>{kids()}</h2> : level === 4 ? <h4 key={key}>{kids()}</h4> : <h3 key={key}>{kids()}</h3>;
    }
    case "bulletList":
      return <ul key={key}>{kids()}</ul>;
    case "orderedList":
      return (
        <ol key={key} start={Number(n.attrs?.start) || 1}>
          {kids()}
        </ol>
      );
    case "listItem":
      return <li key={key}>{kids()}</li>;
    case "blockquote":
      return <blockquote key={key}>{kids()}</blockquote>;
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table>
            <tbody>{kids()}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr key={key}>{kids()}</tr>;
    case "tableCell":
      return (
        <td key={key} colSpan={Number(n.attrs?.colspan) || 1}>
          {kids()}
        </td>
      );
    case "tableHeader":
      return (
        <th key={key} colSpan={Number(n.attrs?.colspan) || 1}>
          {kids()}
        </th>
      );
    case "image": {
      const src = String(n.attrs?.src ?? "");
      const shown = imageSrc ? imageSrc(src) : src;
      if (!shown) return null;
      // our own pictures, behind an access check; next/image cannot size unknown pictures
      // eslint-disable-next-line @next/next/no-img-element
      return <img key={key} src={shown} alt={String(n.attrs?.alt ?? "")} loading="lazy" />;
    }
    default:
      return null;
  }
}

export function SopContent({ doc, words = [], imageSrc, className = "" }: { doc: Doc; words?: string[]; imageSrc?: (src: string) => string; className?: string }) {
  return <div className={`${PROSE} ${className}`}>{(doc?.content ?? []).map((n, i) => node(n, words, i, imageSrc))}</div>;
}
