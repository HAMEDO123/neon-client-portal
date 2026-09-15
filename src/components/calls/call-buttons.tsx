"use client";

import { Phone, PhoneIncoming, Video } from "lucide-react";
import { useCalls } from "@/components/calls/call-provider";
import { mayCallIn } from "@/lib/calls";
import { parseConversation, type ChatViewer } from "@/lib/chat-conversations";
import { cn } from "@/lib/utils";

// The call buttons in a conversation's header: sound, or video. While a call
// is going on in this conversation they become a way into it — or back to it,
// for somebody already in it who minimised the call. Nothing shows in a
// conversation calls are not made in.

export function CallButtons({
  conversation,
  title,
  viewer,
}: {
  /** The conversation as its URL names it. */
  conversation: string;
  title: string;
  viewer: ChatViewer;
}) {
  const calls = useCalls();
  const named = parseConversation(conversation, viewer);
  if (!calls || !named || !mayCallIn(named)) return null;

  const ongoing = calls.calls.find((call) => call.conversationSlug === conversation && call.status !== "ENDED");

  if (ongoing && calls.activeCallId === ongoing.id) {
    return (
      <button type="button" onClick={calls.expand} className={pill}>
        <PhoneIncoming size={15} aria-hidden />
        Back to call
      </button>
    );
  }

  if (ongoing && ongoing.participants.some((part) => part.state === "JOINED")) {
    return (
      <button
        type="button"
        onClick={() => calls.prepare({ mode: "join", callId: ongoing.id, kind: ongoing.kind, title })}
        className={pill}
      >
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-white/80" />
          <span className="relative h-2 w-2 rounded-full bg-white" />
        </span>
        Join call
      </button>
    );
  }

  return (
    <div className="flex shrink-0 items-center">
      <IconButton label={`Call ${title}`} onClick={() => calls.prepare({ mode: "start", conversation, kind: "AUDIO", title })}>
        <Phone size={20} strokeWidth={2} />
      </IconButton>
      <IconButton label={`Video call ${title}`} onClick={() => calls.prepare({ mode: "start", conversation, kind: "VIDEO", title })}>
        <Video size={22} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

const pill =
  "inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-emerald-600 px-3.5 text-sm font-semibold text-white transition-[transform,background-color] hover:bg-emerald-700 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2";

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full text-[#007aff] transition-[transform,background-color] hover:bg-ink/5 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007aff]/50"
      )}
    >
      {children}
    </button>
  );
}
