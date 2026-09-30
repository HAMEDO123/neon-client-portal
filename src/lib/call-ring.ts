import type { Conversation } from "@/lib/chat-conversations";

// What a phone is told when a call rings it through PushKit and CallKit — pure,
// so the payload the app parses is pinned by a test rather than by hope. The
// app (ios/Sources/Features/Calls) reads exactly these keys.

export type RingPayload = {
  type: "incoming-call";
  callId: string;
  /** Who is calling. */
  callerName: string;
  /** What the ringing screen shows: the caller, or the group the call is in. */
  title: string;
  kind: "AUDIO" | "VIDEO";
  isGroup: boolean;
};

export function ringPayload(input: {
  callId: string;
  callerName: string;
  kind: "AUDIO" | "VIDEO";
  conversation: Conversation;
  /** The group's or team's own name, for a call that is not one-to-one. */
  groupName?: string | null;
}): RingPayload {
  const isGroup =
    input.conversation.kind === "team" || input.conversation.kind === "group";
  const fallback =
    input.conversation.kind === "team" ? "NEON Team" : "Group call";
  return {
    type: "incoming-call",
    callId: input.callId,
    callerName: input.callerName,
    title: isGroup ? input.groupName?.trim() || fallback : input.callerName,
    kind: input.kind,
    isGroup,
  };
}
