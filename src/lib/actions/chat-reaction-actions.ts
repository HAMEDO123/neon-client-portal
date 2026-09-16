"use server";

import { chatSide, requireChatViewer } from "@/lib/chat";
import { conversationFromKey, mayOpen } from "@/lib/chat-conversations";
import { MAX_PINNED, isReaction, mayPinAnother } from "@/lib/chat-reactions";
import {
  countPinned,
  messageForAction,
  setPinnedRecord,
  toggleReactionRecord,
} from "@/lib/chat-reaction-store";
import { memberKeyFor } from "@/lib/presence-store";

// Reacting to a message, and pinning one.
//
// Neither writes a message, and both are about words somebody else chose, so
// they go through the same door as every other read: a message is only ever
// reached through the conversation it lives in, and a conversation only
// through mayOpen. An id handed to an action proves nothing by itself.
//
// Neither revalidates. Both travel to every open copy of the conversation over
// the live stream, and redrawing the page as well would undo the point of
// making a reaction feel like a tap.

/** The message an action was asked about, once this viewer is allowed to see it. */
async function openMessage(messageId: string, as: string) {
  const viewer = await requireChatViewer(chatSide(as));

  const message = await messageForAction(messageId);
  if (!message) throw new Error("That message no longer exists.");

  const conversation = conversationFromKey(message.channel.key);
  if (!conversation || !mayOpen(viewer, conversation)) {
    throw new Error("That conversation is not yours.");
  }

  // The manager's exchanges with the assistant are filtered out of every read.
  // They must not be reachable by id either, or the filter is decoration.
  if (message.managerOnly && viewer.type !== "ADMIN") {
    throw new Error("That conversation is not yours.");
  }

  return { viewer, message };
}

/**
 * Gives a reaction, or takes it back when it was already this person's. Says
 * which it did, so the screen that asked can settle on the same answer the
 * database reached rather than guessing from what it drew a moment ago.
 */
export async function reactToMessage(messageId: string, emoji: string, as = "") {
  // The set is closed, and closed on the server: a screen offering six is a
  // convenience, not a rule, and anything can post to a server action.
  if (!isReaction(emoji)) throw new Error("That is not one of the reactions.");

  const { viewer, message } = await openMessage(messageId, as);
  return toggleReactionRecord(message.id, memberKeyFor(viewer), viewer.name, emoji);
}

/**
 * Lifts a message to the top of its conversation, or takes it down.
 *
 * Anybody in the conversation may, and the pin carries their name. Reserving it
 * to the manager would leave it dead in a chat between two employees, which has
 * no manager in it at all — and a pin says "look at this", which is not a thing
 * only one person in a studio of five is entitled to say.
 */
export async function setMessagePinned(messageId: string, pin: boolean, as = "") {
  const { viewer, message } = await openMessage(messageId, as);

  // Only what is not already pinned counts against the limit, and taking one
  // down is never refused.
  if (pin && !message.pinnedAt && !mayPinAnother(await countPinned(message.channelId))) {
    throw new Error(`A conversation holds ${MAX_PINNED} pinned messages at most. Take one down first.`);
  }

  await setPinnedRecord(message.id, pin, memberKeyFor(viewer), viewer.name);
}
