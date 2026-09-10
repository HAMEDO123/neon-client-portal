import { prisma } from "@/lib/db";
import { TEAM_CHANNEL_KEY, directChannelKey } from "@/lib/chat-conversations";

// The two counts in the employee portal's chrome, in one round trip.
//
// They are read on every navigation, so they were the portal's floor for how
// fast a page could appear: four queries — the channel, the read marker, the
// chat count and the notification count — before anything rendered. Against a
// hosted database that is four round trips of latency on every tap. As one
// statement it is one.
//
// The chat count is both of the employee's conversations: the team's and their
// private one with the manager, each measured against its own read marker.

export type EmployeeBadges = { unread: number; unreadChat: number };

export async function getEmployeeBadges(employeeId: string): Promise<EmployeeBadges> {
  try {
    const rows = await prisma.$queryRaw<{ unread: bigint; unread_chat: bigint }[]>`
      SELECT
        (
          SELECT COUNT(*) FROM "Notification"
          WHERE "employeeId" = ${employeeId} AND "readAt" IS NULL
        ) AS unread,
        (
          SELECT COUNT(*) FROM "ChatMessage" m
          JOIN "ChatChannel" c ON c.id = m."channelId"
            AND c.key IN (${TEAM_CHANNEL_KEY}, ${directChannelKey(employeeId)})
          LEFT JOIN "ChatRead" r ON r."channelId" = c.id AND r."readerKey" = ${employeeId}
          WHERE m."managerOnly" = false
            -- Your own messages are not news.
            AND NOT (m."authorType" = 'EMPLOYEE' AND m."authorId" = ${employeeId})
            AND m."createdAt" > COALESCE(r."lastReadAt", TIMESTAMP '-infinity')
        ) AS unread_chat
    `;

    const row = rows[0];
    return {
      unread: Number(row?.unread ?? 0),
      unreadChat: Number(row?.unread_chat ?? 0),
    };
  } catch {
    // A badge is not worth failing a page render over.
    return { unread: 0, unreadChat: 0 };
  }
}
