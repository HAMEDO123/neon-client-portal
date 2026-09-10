import { prisma } from "@/lib/db";
import {
  DIRECT_KEY_PATTERN,
  TEAM_CHANNEL_KEY,
  directChannelKey,
  type ChatViewer,
} from "@/lib/chat-conversations";

// When the newest thing worth a sound happened, for one person.
//
// The heartbeat (/api/live) only says that something somewhere changed. This
// says whether it was for you, and which kind: the newest message somebody
// else sent into a conversation you are in, and the newest of your other
// notifications. The app compares them with the last it heard and plays the
// matching sound. Timestamps rather than unread counts, because a count also
// moves when something is read, and reading is not news.

export type Cues = { messages: number; updates: number };

type Row = { messages: Date | null; updates: Date | null };

export async function latestCues(viewer: ChatViewer): Promise<Cues> {
  const rows =
    viewer.type === "ADMIN"
      ? await prisma.$queryRaw<Row[]>`
          SELECT
            (
              SELECT MAX(m."createdAt") FROM "ChatMessage" m
              JOIN "ChatChannel" c ON c.id = m."channelId"
              WHERE (c.key = ${TEAM_CHANNEL_KEY} OR c.key LIKE ${DIRECT_KEY_PATTERN})
                AND m."authorType" = 'EMPLOYEE'
                AND m."managerOnly" = false
            ) AS messages,
            (SELECT MAX("createdAt") FROM "AdminNotification") AS updates
        `
      : await prisma.$queryRaw<Row[]>`
          SELECT
            (
              SELECT MAX(m."createdAt") FROM "ChatMessage" m
              JOIN "ChatChannel" c ON c.id = m."channelId"
              WHERE c.key IN (${TEAM_CHANNEL_KEY}, ${directChannelKey(viewer.id)})
                AND m."managerOnly" = false
                AND NOT (m."authorType" = 'EMPLOYEE' AND m."authorId" = ${viewer.id})
            ) AS messages,
            (
              -- A chat message is already the other sound.
              SELECT MAX("createdAt") FROM "Notification"
              WHERE "employeeId" = ${viewer.id} AND "type" <> 'CHAT_MESSAGE'
            ) AS updates
        `;

  const row = rows[0];
  return { messages: row?.messages?.getTime() ?? 0, updates: row?.updates?.getTime() ?? 0 };
}
