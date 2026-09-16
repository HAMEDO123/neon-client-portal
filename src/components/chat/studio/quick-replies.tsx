"use client";

// The four answers a team gives all day, one tap away: got it, on it, an
// update is coming, this needs another pair of eyes. Tapping one sends it as
// an ordinary message — there is no separate kind of "reaction" behind them,
// so the conversation reads the same to everybody, on a phone as on a desk.

const REPLIES = [
  { emoji: "👍", label: "Got it" },
  { emoji: "✅", label: "On it" },
  { emoji: "📅", label: "Will update" },
  { emoji: "💡", label: "Need review" },
] as const;

export function QuickReplies({ onPick, disabled = false }: { onPick: (text: string) => void; disabled?: boolean }) {
  return (
    // One row that scrolls sideways rather than stacking: three lines of chips
    // above the message box push the conversation off the screen.
    <div
      className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="Quick replies"
    >
      {REPLIES.map((reply) => (
        <button
          key={reply.label}
          type="button"
          disabled={disabled}
          onClick={() => onPick(`${reply.emoji} ${reply.label}`)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-warm-line bg-card px-3 text-[13px] font-medium text-bark/70 transition-[transform,background-color,color] hover:bg-clay-soft/70 hover:text-bark active:scale-[0.97] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay/40"
        >
          <span aria-hidden>{reply.emoji}</span>
          {reply.label}
        </button>
      ))}
    </div>
  );
}
