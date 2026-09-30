import { prisma } from "@/lib/db";
import type { Conversation } from "@/lib/chat-conversations";
import { RING_MS } from "@/lib/calls";
import { notifiableEmployeeId } from "@/lib/manager-account";
import {
  deviceOutcome,
  isApnsConfigured,
  sendVoip,
} from "@/lib/notifications/apns";
import { ringPayload } from "@/lib/call-ring";

// Ringing phones for a call: a PushKit push to every VoIP token the people
// asked have registered, which the app hands to CallKit — the iPhone's own
// ringing screen, with the app closed or the phone locked.
//
// Nothing here says a call ended. While it rings the app is running (CallKit
// keeps it alive) and its calls stream says when the call was answered,
// declined or given up on, which is how the ringing stops.

/** The name the ringing screen shows for a call that is not one-to-one. */
export async function conversationName(
  conversation: Conversation,
): Promise<string | null> {
  if (conversation.kind === "team") return "NEON Team";
  if (conversation.kind !== "group") return null;
  const group = await prisma.chatGroup.findUnique({
    where: { id: conversation.groupId },
    select: { name: true },
  });
  return group?.name ?? null;
}

/**
 * Rings each member's phones. Answers with the member keys whose phone took at
 * least one ring, so the caller can leave the ordinary "Incoming call" banner
 * off those phones rather than show it on top of the ringing screen.
 */
export async function ringPhones(
  memberKeys: string[],
  call: {
    id: string;
    callerName: string;
    kind: "AUDIO" | "VIDEO";
    conversation: Conversation;
  },
): Promise<Set<string>> {
  const rang = new Set<string>();
  if (!isApnsConfigured() || memberKeys.length === 0) return rang;

  const payload = ringPayload({
    callId: call.id,
    callerName: call.callerName,
    kind: call.kind,
    conversation: call.conversation,
    groupName: await conversationName(call.conversation),
  });

  await Promise.all(
    memberKeys.map(async (key) => {
      const employeeId = await notifiableEmployeeId(key);
      if (!employeeId) return;
      const devices = await prisma.deviceToken.findMany({
        where: {
          employeeId,
          active: true,
          kind: "VOIP",
          employee: { active: true },
        },
      });
      for (const device of devices) {
        const result = await sendVoip(
          {
            token: device.token,
            bundleId: device.bundleId,
            sandbox: device.sandbox,
          },
          payload,
          Math.ceil(RING_MS / 1000),
        );
        if (result.ok) rang.add(key);
        const outcome = deviceOutcome(result, device.failureCount);
        await prisma.deviceToken
          .update({
            where: { id: device.id },
            data: {
              active: outcome.active,
              failureCount: outcome.failureCount,
              lastUsedAt: result.ok ? new Date() : device.lastUsedAt,
            },
          })
          .catch(() => undefined);
      }
    }),
  );

  return rang;
}
