"use client";

// The Red Panda trip assistant's chat (the conversation; the reading is done on the server).
import { useEffect, useRef, useState } from "react";
import { ui } from "@/components/ui";
import { Icon } from "@/components/icons";

export interface RpChatMessage {
  role: "user" | "assistant";
  text: string;
  source?: string;
  quick?: string[]; // answers to tap
}

export function RpChat({ messages, busy, onSend }: { messages: RpChatMessage[]; busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // braces: newer browsers return a value from scrollIntoView, and an effect may only return a clean-up function
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  const last = messages[messages.length - 1];
  const send = (t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
  };
  return (
    <section className={`${ui.card} flex flex-col overflow-hidden`} aria-label="Trip assistant">
      <header className="flex items-center gap-2 border-b border-sand-200 px-3 py-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-olive-600 text-white">
          <Icon name="send" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-olive-800">Trip assistant</p>
          <p className="text-xs text-sand-500">Paste the enquiry; I fill the quote and ask what is missing</p>
        </div>
      </header>
      <div className="max-h-[min(55vh,520px)] min-h-[160px] space-y-3 overflow-y-auto bg-sand-50 p-3" aria-live="polite">
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
                <p className="whitespace-pre-line rounded-2xl rounded-tl-sm border border-sand-200 bg-white px-3.5 py-2 text-sm">{m.text}</p>
                {m.source && <p className="px-1 text-[11px] text-sand-400">{m.source}</p>}
                {m === last && m.quick && m.quick.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.quick.map((q) => (
                      <button key={q} type="button" disabled={busy} onClick={() => send(q)} className={`${ui.btnSecondary} ${ui.btnSm}`}>
                        {q}
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
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="e.g. 2 adults from the UK, arriving Bagdogra 20 Nov, 5 nights, 1 night Mayfair after"
            className={`${ui.input} min-h-[72px] flex-1 resize-none`}
            aria-label="Message"
          />
          <button type="button" className={ui.btnPrimary} disabled={busy || !text.trim()} onClick={() => send(text)} aria-label="Send">
            <Icon name="send" className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </section>
  );
}
