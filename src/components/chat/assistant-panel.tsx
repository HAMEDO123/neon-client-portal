"use client";

import { useState, useTransition } from "react";
import { Bot, Send, Sparkles } from "lucide-react";
import { askChatAssistant } from "@/lib/actions/chat-actions";
import { cn } from "@/lib/utils";

// The manager's private line to the assistant. Employees never render this —
// and even if they did, the action refuses anyone but the admin session.
//
// It sits under the manager's own conversation, so it wears the studio's warm
// palette rather than a colour of its own.

const SUGGESTIONS = [
  "What did the team report today?",
  "Anything I should follow up on?",
  "What is outstanding on Villa Al-Fulan?",
];

export function AssistantPanel({ configured }: { configured: boolean }) {
  const [pending, startTransition] = useTransition();
  const [question, setQuestion] = useState("");
  const [open, setOpen] = useState(false);

  function ask(text: string) {
    const value = text.trim();
    if (!value) return;
    const formData = new FormData();
    formData.set("question", value);
    startTransition(async () => {
      await askChatAssistant(formData);
      setQuestion("");
    });
  }

  return (
    <div className="shrink-0 border-t border-warm-line bg-clay-soft/40 p-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-clay-deep"
      >
        <Bot size={14} strokeWidth={2} />
        Ask the assistant
        <span className="ml-auto font-normal normal-case tracking-normal text-bark/40">
          {open ? "Hide" : "Only you can see this"}
        </span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          {!configured && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
              The assistant needs ANTHROPIC_API_KEY set on the server before it can answer.
            </p>
          )}

          <div className="flex gap-2">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  ask(question);
                }
              }}
              placeholder="Ask about anything the team has said…"
              className="min-h-11 flex-1 rounded-2xl border border-warm-line bg-card px-3 py-2.5 text-sm text-bark outline-none placeholder:text-bark/35 focus:border-clay"
            />
            <button
              type="button"
              onClick={() => ask(question)}
              disabled={pending || !question.trim()}
              aria-label="Ask"
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition-opacity",
                "bg-clay disabled:opacity-30"
              )}
            >
              {pending ? <Sparkles size={17} className="animate-pulse" /> : <Send size={17} strokeWidth={2} />}
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion)}
                disabled={pending}
                className="rounded-full border border-warm-line bg-card px-2.5 py-1 text-[11px] text-bark/60 hover:text-bark disabled:opacity-40"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <p className="text-[11px] text-bark/40">
            It reads the team conversation only — your questions and its answers stay private to you.
          </p>
        </div>
      )}
    </div>
  );
}
