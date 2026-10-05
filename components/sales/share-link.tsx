"use client";

import { useEffect, useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";

// Shows the client link for the current version, with copy and open buttons.
export function ShareLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  // Read the site address after mount so server and browser render the same HTML.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = origin + path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.origin + path);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link:", window.location.origin + path);
    }
  }

  return (
    <div className="space-y-2">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${ui.inputSm} text-xs`} aria-label="Client link" />
      <div className="flex gap-2">
        <button type="button" onClick={copy} className={`${ui.btnSecondary} ${ui.btnSm} flex-1`}>
          <Icon name={copied ? "check" : "send"} className="h-4 w-4" />
          {copied ? "Copied" : "Copy link"}
        </button>
        <a href={path} target="_blank" rel="noopener noreferrer" className={`${ui.btnPrimary} ${ui.btnSm} flex-1`}>
          Open client view
        </a>
      </div>
      <p className="text-xs text-sand-500">Anyone with this link can view this version. Use Download PDF on that page to save or print it.</p>
    </div>
  );
}
