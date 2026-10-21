"use client";

import { useEffect, useRef, useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { ChatMessage, QuickReply } from "@/lib/sales/plan/chat";

export function ChatPanel({
  messages,
  busy,
  onSend,
  onQuick,
  aiAvailable,
}: {
  messages: ChatMessage[];
  busy: boolean;
  onSend: (text: string) => void;
  onQuick: (q: QuickReply) => void;
  aiAvailable: boolean;
}) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  function send() {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
    if (inputRef.current) inputRef.current.style.height = "";
    inputRef.current?.focus();
  }

  const last = messages[messages.length - 1];

  return (
    <section className={`${ui.card} flex flex-col overflow-hidden`} aria-label="Trip assistant">
      <header className="flex items-center gap-2 border-b border-sand-200 px-3 py-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-olive-600 text-white">
          <Icon name="send" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-olive-800">Trip assistant</p>
          <p className="text-xs text-sand-500">{aiAvailable ? "Built-in reader, with AI help when needed" : "Built-in reader"}</p>
        </div>
      </header>

      <div className="max-h-[min(55vh,520px)] min-h-[140px] space-y-3 overflow-y-auto bg-sand-50 p-3" aria-live="polite">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-sm bg-olive-600 px-3.5 py-2 text-sm text-white">{m.text}</p>
            </div>
          ) : (
            <div key={i} className="flex gap-2">
              <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-olive-100 text-olive-700">
                <Icon name="send" className="h-3 w-3" />
              </span>
              <div className="max-w-[90%] space-y-2">
                {m.chips && m.chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.chips.map((c, k) => (
                      <span key={k} className="inline-flex items-center gap-1 rounded-full border border-success-border bg-success-bg px-2 py-0.5 text-xs font-medium text-success">
                        <Icon name="check" className="h-3 w-3" />
                        {c}
                      </span>
                    ))}
                  </div>
                )}
                <p className="whitespace-pre-line rounded-2xl rounded-tl-sm border border-sand-200 bg-white px-3.5 py-2 text-sm">{m.text}</p>
                {m.warnings && m.warnings.length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning">
                    {m.warnings.map((w, k) => (
                      <li key={k} className="flex gap-1.5">
                        <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        {w}
                      </li>
                    ))}
                  </ul>
                )}
                {m === last && m.quick && m.quick.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.quick.map((q, k) => (
                      <button
                        key={k}
                        type="button"
                        disabled={busy}
                        onClick={() => onQuick(q)}
                        className={q.action ? `${ui.btnPrimary} ${ui.btnSm}` : `${ui.btnSecondary} ${ui.btnSm}`}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        )}
        {busy && (
          <div className="flex items-center gap-2 text-xs text-sand-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-olive-400" />
            Reading...
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-sand-200 bg-white p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={4}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              // grow with the text, up to about 12 lines
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 280)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder='Type the trip or a change, e.g. "make Pench 2 nights"'
            className={`${ui.inputSm} min-h-[96px] resize-y leading-relaxed`}
            aria-label="Message to the trip assistant"
          />
          <button type="button" onClick={send} disabled={busy || !text.trim()} className={`${ui.btnPrimary} shrink-0`} aria-label="Send">
            <Icon name="send" className="h-[18px] w-[18px]" />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-sand-500">Enter to send, Shift+Enter for a new line. Say &quot;start over&quot; to clear.</p>
      </div>
    </section>
  );
}
