"use client";

import { useEffect, useState } from "react";

// Share the guest itinerary: WhatsApp, email, the phone's own share sheet, or copy the link.
// The link is read after mount, so it is always the address the guest is looking at.
const PATHS = {
  whatsapp:
    "M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3zm4.4 12.6c-.2.5-1.1 1-1.6 1.1-.4.1-.9.1-1.5-.1-.3-.1-.8-.3-1.4-.5-2.4-1-4-3.5-4.1-3.6-.1-.2-1-1.3-1-2.5s.6-1.8.9-2.1c.2-.2.5-.3.6-.3h.5c.1 0 .4 0 .6.4l.8 1.9c.1.2.1.3 0 .5l-.3.4-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1.1.9 2 1.2 2.3 1.4.3.1.4.1.6-.1l.8-1c.2-.2.4-.2.6-.1l1.8.9c.3.1.4.2.5.3.1.2.1.7-.2 1.4z",
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  share: "M12 3v12m0-12-4 4m4-4 4 4M5 13v6h14v-6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  check: "M5 12.5l4.5 4.5L19 7.5",
};

function Glyph({ d, fill = false }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function ShareButtons({ title, text }: { title: string; text: string }) {
  const [url, setUrl] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setUrl(window.location.href.split("#")[0]);
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  const message = `${text}\n${url}`;
  const btn =
    "inline-flex min-h-10 items-center gap-2 rounded-full border border-sand-300 bg-white px-3.5 py-2 text-sm font-medium text-olive-800 shadow-card transition hover:border-olive-300 hover:bg-olive-50";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Share this itinerary">
      <span className="mr-1 text-xs font-semibold uppercase tracking-[0.15em] text-sand-500">Share</span>
      <a className={btn} href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
        <span className="text-[#25D366]">
          <Glyph d={PATHS.whatsapp} fill />
        </span>
        WhatsApp
      </a>
      <a className={btn} href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(message)}`} aria-label="Share by email">
        <Glyph d={PATHS.mail} />
        Email
      </a>
      {canShare && (
        <button type="button" className={btn} onClick={() => navigator.share({ title, text, url }).catch(() => undefined)} aria-label="More ways to share">
          <Glyph d={PATHS.share} />
          More
        </button>
      )}
      <button type="button" className={btn} onClick={copy} aria-label="Copy the link">
        <Glyph d={copied ? PATHS.check : PATHS.link} />
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
