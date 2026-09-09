import { prisma } from "@/lib/db";
import { TEAM_CHANNEL_KEY } from "@/lib/chat";

// The counts beside the admin sidebar's links, in one round trip.
//
// The sidebar renders on every admin page, so this runs on every navigation —
// the same reason the employee badges are one query rather than four.

export type AdminBadges = { chat: number; requests: number; reviews: number; alerts: number };

export async function getAdminBadges(): Promise<AdminBadges> {
  try {
    const rows = await prisma.$queryRaw<
      { chat: bigint; requests: bigint; reviews: bigint; alerts: bigint }[]
    >`
      SELECT
        (
          SELECT COUNT(*) FROM "ChatMessage" m
          JOIN "ChatChannel" c ON c.id = m."channelId" AND c.key = ${TEAM_CHANNEL_KEY}
          -- The manager's own messages, and their private exchanges with the
          -- assistant, are not unread news for them.
          WHERE m."authorType" <> 'ADMIN'
            AND m."managerOnly" = false
            AND m."createdAt" > COALESCE(
              (
                SELECT r."lastReadAt" FROM "ChatRead" r
                JOIN "ChatChannel" c2 ON c2.id = r."channelId" AND c2.key = ${TEAM_CHANNEL_KEY}
                WHERE r."readerKey" = 'admin'
              ),
              TIMESTAMP '-infinity'
            )
        ) AS chat,
        (
          SELECT COUNT(*) FROM "SupplyRequest" WHERE "status" = 'PENDING'
        ) AS requests,
        (
          SELECT COUNT(*) FROM "TaskSubmission" WHERE "status" = 'PENDING'
        ) AS reviews,
        (
          SELECT COUNT(*) FROM "AdminNotification" WHERE "readAt" IS NULL
        ) AS alerts
    `;

    const row = rows[0];
    return {
      chat: Number(row?.chat ?? 0),
      requests: Number(row?.requests ?? 0),
      reviews: Number(row?.reviews ?? 0),
      alerts: Number(row?.alerts ?? 0),
    };
  } catch {
    // A badge is not worth failing a page render over.
    return { chat: 0, requests: 0, reviews: 0, alerts: 0 };
  }
}
