"use client";

import { useEffect, useRef, useTransition } from "react";
import { Bot, Download, FileText, Trash2 } from "lucide-react";
import { deleteChatMessage } from "@/lib/actions/chat-actions";
import type { ChatMessageView } from "@/lib/chat";
import { cn } from "@/lib/utils";

// The conversation. Own messages sit right, everyone else's left, and the
// assistant's answers are visually separate so the manager can tell at a
// glance what only they can see.

function timeLabel(date: Date) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" }).format(date);
}

export function ChatMessageList({
  messages,
  viewerType,
  viewerId,
  canDeleteAny,
}: {
  messages: ChatMessageView[];
  viewerType: "ADMIN" | "EMPLOYEE";
  viewerId: string | null;
  canDeleteAny: boolean;
}) {
  const [, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  // A chat opens at the newest message, not the oldest.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Which messages start a new day, decided before rendering rather than by
  // mutating a variable as the list is built.
  const dayHeadings = messages.map((message, index) => {
    const day = dayLabel(message.createdAt);
    const previous = index > 0 ? dayLabel(messages[index - 1].createdAt) : null;
    return day === previous ? null : day;
  });

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
      {messages.length === 0 && (
        <p className="my-auto text-center text-sm text-ink/40">
          No messages yet. Say hello, send a photo from site, or record a voice note.
        </p>
      )}

      {messages.map((message, index) => {
        const mine =
          message.authorType === viewerType &&
          (viewerType === "ADMIN" ? true : message.authorId === viewerId);
        const isAgent = message.authorType === "AGENT";

        const day = dayHeadings[index];

        return (
          <div key={message.id} className="flex flex-col">
            {day && (
              <div className="my-3 flex items-center gap-3">
                <span className="h-px flex-1 bg-ink/8" />
                <span className="text-[11px] font-medium uppercase tracking-wider text-ink/35">{day}</span>
                <span className="h-px flex-1 bg-ink/8" />
              </div>
            )}

            <div className={cn("group/msg flex", mine && !isAgent ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2.5",
                  isAgent
                    ? "border border-purple/25 bg-purple/[0.07]"
                    : mine
                      ? "bg-ink text-bg"
                      : "border border-ink/8 bg-white"
                )}
              >
                {!mine && (
                  <p
                    className={cn(
                      "mb-1 inline-flex items-center gap-1.5 text-[11px] font-semibold",
                      isAgent ? "text-purple-strong" : "text-cyan-strong"
                    )}
                  >
                    {isAgent && <Bot size={12} strokeWidth={2.25} />}
                    {message.authorName}
                    {/* The manager's display name is already "Manager"; only
                        add the role when the name does not say it. */}
                    {message.authorType === "ADMIN" && message.authorName !== "Manager" && " · Manager"}
                  </p>
                )}

                {message.kind === "IMAGE" && message.attachmentUrl && (
                  <a href={message.attachmentUrl} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={message.attachmentUrl}
                      alt={message.attachmentName ?? "Photo"}
                      className="mb-1.5 max-h-72 w-full rounded-xl object-cover"
                    />
                  </a>
                )}

                {message.kind === "VOICE" && message.attachmentUrl && (
                  <div className="mb-1 flex items-center gap-2">
                    <audio src={message.attachmentUrl} controls preload="none" className="h-9 max-w-56" />
                    {message.durationSeconds ? (
                      <span className={cn("text-[11px]", mine ? "text-bg/60" : "text-ink/40")}>
                        {message.durationSeconds}s
                      </span>
                    ) : null}
                  </div>
                )}

                {message.kind === "FILE" && message.attachmentUrl && (
                  <a
                    href={message.attachmentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "mb-1 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                      mine ? "bg-bg/15" : "bg-ink/5"
                    )}
                  >
                    <FileText size={15} strokeWidth={1.75} />
                    <span className="max-w-48 truncate">{message.attachmentName}</span>
                    <Download size={13} strokeWidth={2} />
                  </a>
                )}

                {message.body && (
                  <p className={cn("whitespace-pre-wrap text-sm", isAgent && "text-ink/80")}>{message.body}</p>
                )}

                <div className="mt-1 flex items-center justify-end gap-2">
                  {message.project && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        mine && !isAgent ? "bg-bg/15 text-bg/80" : "bg-ink/5 text-ink/45"
                      )}
                    >
                      {message.project.name}
                    </span>
                  )}
                  <span className={cn("text-[10px]", mine && !isAgent ? "text-bg/50" : "text-ink/35")}>
                    {timeLabel(message.createdAt)}
                  </span>
                  {(canDeleteAny || (mine && !isAgent)) && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm("Delete this message?")) {
                          startTransition(() => deleteChatMessage(message.id));
                        }
                      }}
                      aria-label="Delete message"
                      className={cn(
                        "opacity-0 transition-opacity group-hover/msg:opacity-100",
                        mine && !isAgent ? "text-bg/50 hover:text-bg" : "text-ink/25 hover:text-red-600"
                      )}
                    >
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div ref={endRef} />
    </div>
  );
}
