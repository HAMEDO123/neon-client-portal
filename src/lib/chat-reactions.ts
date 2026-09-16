// A reaction is the smallest reply there is: it says somebody read this and
// what they made of it, without putting another message in front of everybody
// else in the conversation. Pinning is the other half of the same idea — one
// message lifted out of a day's scrolling so it can be found again.
//
// Rules only. The database side is chat-reaction-store.ts and the sessions are
// actions/chat-reaction-actions.ts.

/**
 * The six.
 *
 * A fixed set rather than whatever the keyboard can produce, for two reasons:
 * a row of reactions has to stay readable at a glance underneath a message,
 * and a tally is only a tally while everybody is counting the same things. An
 * open field becomes a private language between two people that the third
 * cannot read.
 *
 * They are the words this platform already says — the quick replies over the
 * composer are 👍 Got it, ✅ On it, 📅 Will update, 💡 Need review — so
 * agreeing with a tap and agreeing with a reply mean the same thing here.
 */
export const REACTIONS = ["👍", "❤️", "😂", "🙏", "👀", "✅"] as const;

export type Reaction = (typeof REACTIONS)[number];

export function isReaction(value: string): value is Reaction {
  return (REACTIONS as readonly string[]).includes(value);
}

/** One person's one reaction, as the database keeps it. */
export type ReactionRow = { emoji: string; memberKey: string; memberName: string };

export type ReactionTally = {
  emoji: string;
  count: number;
  /** Whether the person looking is one of them. */
  mine: boolean;
  /** Who, so the row can say it rather than making anybody guess. */
  names: string[];
};

/**
 * The row under a message: each emoji once, most-given first.
 *
 * Ties break on the fixed order above and then on the emoji itself, so the row
 * is the same every time it is drawn. A tally that reshuffles when somebody
 * adds a reaction moves the thing under the finger that is reaching for it.
 */
export function tally(rows: ReactionRow[], myKey: string): ReactionTally[] {
  const order = new Map<string, number>(REACTIONS.map((emoji, index) => [emoji as string, index]));
  const byEmoji = new Map<string, ReactionTally>();

  for (const row of rows) {
    const seen = byEmoji.get(row.emoji);
    if (seen) {
      seen.count += 1;
      seen.names.push(row.memberName);
      if (row.memberKey === myKey) seen.mine = true;
      continue;
    }
    byEmoji.set(row.emoji, {
      emoji: row.emoji,
      count: 1,
      mine: row.memberKey === myKey,
      names: [row.memberName],
    });
  }

  return [...byEmoji.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    // An emoji that is no longer offered still counts and sorts last: taking
    // one out of the set must never delete what somebody already said with it.
    const left = order.get(a.emoji) ?? REACTIONS.length;
    const right = order.get(b.emoji) ?? REACTIONS.length;
    if (left !== right) return left - right;
    return a.emoji.localeCompare(b.emoji);
  });
}

/** What pressing an emoji does: give it, or take it back when it is already yours. */
export function toggleOf(rows: ReactionRow[], myKey: string, emoji: string): "add" | "remove" {
  return rows.some((row) => row.memberKey === myKey && row.emoji === emoji) ? "remove" : "add";
}

/** How many people gave anything, for the one-line summary a screen reader reads. */
export function reactionCount(rows: ReactionRow[]) {
  return rows.length;
}

/**
 * How many messages one conversation may hold pinned.
 *
 * A conversation with forty pinned messages has none: the point of a pin is
 * that it is short enough to read on the way past.
 */
export const MAX_PINNED = 10;

/**
 * Whether another message fits.
 *
 * Refused rather than quietly unpinning the oldest to make room — somebody
 * pinning a message must never take down somebody else's without being told,
 * and a silent eviction is indistinguishable from a bug.
 */
export function mayPinAnother(pinnedNow: number) {
  return pinnedNow < MAX_PINNED;
}
