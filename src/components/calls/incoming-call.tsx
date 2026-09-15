"use client";

import { useId } from "react";
import { Loader2, Phone, PhoneOff, Video } from "lucide-react";
import type { CallView } from "@/lib/call-store";
import { PersonAvatar } from "@/components/chat/person-avatar";

// A call ringing, on whatever page is open: who is calling, and answer or
// decline. A video call can also be answered with sound only. Escape declines.

export function IncomingCall({
  call,
  inCall,
  answering,
  onAccept,
  onDecline,
}: {
  call: CallView;
  /** Already in another call: answering ends that one. */
  inCall: boolean;
  answering: boolean;
  onAccept: (video: boolean) => void;
  onDecline: () => void;
}) {
  const ids = useId();
  const caller = call.participants.find((part) => part.memberKey === call.startedByKey);
  const video = call.kind === "VIDEO";

  const title = call.isGroup ? call.title : call.startedByName;
  const line = call.isGroup
    ? `${call.startedByName} started a ${video ? "video call" : "call"}`
    : video
      ? "Incoming video call…"
      : "Incoming call…";

  return (
    <div
      role="alertdialog"
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-line`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDecline();
      }}
      className="call-drop fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] mx-auto max-w-sm rounded-3xl bg-[#15131f]/95 p-4 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex shrink-0">
          <span aria-hidden className="call-pulse absolute inset-0 rounded-full" />
          <PersonAvatar name={caller?.name ?? call.startedByName} color={caller?.color} size={48} className="relative" />
        </span>
        <div className="min-w-0 flex-1">
          <p id={`${ids}-title`} className="truncate text-base font-semibold">
            {title}
          </p>
          <p id={`${ids}-line`} className="text-sm text-white/60">
            {line}
          </p>
        </div>
      </div>

      {inCall && (
        <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/75">Answering ends the call you are in.</p>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onDecline}
          disabled={answering}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-red-500 text-sm font-semibold transition-[transform,background-color] hover:bg-red-600 active:scale-[0.97] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#15131f]"
        >
          <PhoneOff size={18} aria-hidden />
          Decline
        </button>
        {video && (
          <button
            type="button"
            onClick={() => onAccept(false)}
            disabled={answering}
            aria-label="Answer with sound only"
            title="Answer with sound only"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 transition-[transform,background-color] hover:bg-white/25 active:scale-[0.97] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <Phone size={18} aria-hidden />
          </button>
        )}
        <button
          type="button"
          autoFocus
          onClick={() => onAccept(video)}
          disabled={answering}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-emerald-500 text-sm font-semibold transition-[transform,background-color] hover:bg-emerald-600 active:scale-[0.97] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#15131f]"
        >
          {answering ? (
            <Loader2 size={18} className="animate-spin" aria-hidden />
          ) : video ? (
            <Video size={18} aria-hidden />
          ) : (
            <Phone size={18} aria-hidden />
          )}
          {answering ? "Connecting…" : "Answer"}
        </button>
      </div>
    </div>
  );
}
