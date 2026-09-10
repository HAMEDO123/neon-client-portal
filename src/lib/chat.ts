import { cookies } from "next/headers";
import { Prisma } from "@/generated/prisma/client";
import type { ChatMessageKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSessionEmployee } from "@/lib/employee-session";
import { avatarUrl } from "@/lib/avatar";
import {
  GROUP_AVATAR,
  TEAM_CHANNEL_KEY,
  directChannelKey,
  mayOpen,
  type ChatSide,
  type ChatViewer,
  type Conversation,
  type LastMessage,
} from "@/lib/chat-conversations";

export {
  GROUP_AVATAR,
  TEAM_CHANNEL_KEY,
  directChannelKey,
  chatSide,
  parseConversation,
  type ChatSide,
  type ChatViewer,
  type Conversation,
} from "@/lib/chat-conversations";

// The conversations, shared by the admin portal and the employee portal.
//
// One team conversation everybody is in, and one private conversation between
// the manager and each employee. Both portals read and write through here, and
// every read and write finds its channel through channelFor — so there is
// exactly one definition of who may see what: an employee sees the team and
// their own private chat, never another employee's; the manager sees all of
// them, plus their own exchanges with the assistant in the team conversation.

/**
 * Resolves whoever is asking from their session cookie. Never takes an
 * identity from the caller — an employee cannot claim to be the manager by
 * passing a different id.
 *
 * One browser can hold both sessions — the manager trying the employee portal
 * on their own phone — so a portal says which side it is on, and gets that
 * session or nobody. Naming a side only chooses between sessions the browser
 * already holds; it can never add one. With no side named, the manager's
 * session comes first, as it always has.
 */
export async function getChatViewer(side?: ChatSide): Promise<ChatViewer | null> {
  const store = await cookies();

  if (side !== "EMPLOYEE" && verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    return { type: "ADMIN", id: null, name: "Manager" };
  }
  if (side === "ADMIN") return null;

  const employee = await getSessionEmployee();
  if (employee) return { type: "EMPLOYEE", id: employee.id, name: employee.name };

  return null;
}

export async function requireChatViewer(side?: ChatSide): Promise<ChatViewer> {
  const viewer = await getChatViewer(side);
  if (!viewer) throw new Error("Unauthorized");
  return viewer;
}

/**
 * The single team channel, created on first use.
 *
 * Reads must not write: an upsert here put an INSERT in the path of every
 * page render, which collides with anything running concurrently on the same
 * connection. Look first, and only create when it genuinely does not exist.
 */
export async function getTeamChannel() {
  const existing = await prisma.chatChannel.findUnique({ where: { key: TEAM_CHANNEL_KEY } });
  if (existing) return existing;

  try {
    return await prisma.chatChannel.create({ data: { key: TEAM_CHANNEL_KEY, name: "NEON Team" } });
  } catch {
    // Two first-ever requests raced; the other one won.
    return prisma.chatChannel.findUniqueOrThrow({ where: { key: TEAM_CHANNEL_KEY } });
  }
}

/** The private conversation with one employee, created the first time either side opens it. */
async function getDirectChannel(employeeId: string) {
  const key = directChannelKey(employeeId);
  const existing = await prisma.chatChannel.findUnique({ where: { key } });
  if (existing) return existing;

  // Only somebody on the team has a private conversation with the manager.
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, accessRole: "EMPLOYEE" },
    select: { name: true },
  });
  if (!employee) return null;

  try {
    return await prisma.chatChannel.create({ data: { key, name: employee.name } });
  } catch {
    // Both sides opened it at once; the other request made it.
    return prisma.chatChannel.findUnique({ where: { key } });
  }
}

/**
 * The channel behind a conversation, or null when this viewer may not open it.
 * The rule itself is mayOpen, in chat-conversations.ts.
 */
export async function channelFor(viewer: ChatViewer, conversation: Conversation) {
  if (!mayOpen(viewer, conversation)) return null;
  return conversation.kind === "team" ? getTeamChannel() : getDirectChannel(conversation.employeeId);
}

// Assistant messages belong to the manager alone, so they are filtered out in
// the query rather than hidden in the UI.
function visibilityFilter(viewer: ChatViewer) {
  return viewer.type === "ADMIN" ? {} : { managerOnly: false };
}

export const messageSelect = {
  id: true,
  authorType: true,
  authorId: true,
  authorName: true,
  kind: true,
  body: true,
  attachmentUrl: true,
  attachmentName: true,
  attachmentType: true,
  attachmentSize: true,
  durationSeconds: true,
  managerOnly: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
} as const;

/** One conversation's messages, for a channel already resolved through channelFor. */
export async function listMessages(viewer: ChatViewer, channelId: string, take = 200) {
  const messages = await prisma.chatMessage.findMany({
    where: { channelId, ...visibilityFilter(viewer) },
    orderBy: { createdAt: "desc" },
    take,
    select: messageSelect,
  });

  // Newest first from the database so `take` keeps the most recent, oldest
  // first for reading.
  return messages.reverse();
}

/**
 * The conversation as the assistant sees it: the team's messages only — never
 * a private conversation, and never the manager's exchanges with the assistant.
 */
export async function conversationForAgent(limit = 300) {
  const channel = await getTeamChannel();

  const messages = await prisma.chatMessage.findMany({
    where: { channelId: channel.id, managerOnly: false },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      authorType: true,
      authorName: true,
      kind: true,
      body: true,
      attachmentName: true,
      createdAt: true,
      project: { select: { name: true } },
    },
  });

  return messages.reverse();
}

/** "admin" for the manager, the employee id otherwise. Never null. */
export function readerKeyFor(viewer: ChatViewer) {
  return viewer.type === "ADMIN" ? "admin" : viewer.id;
}

/**
 * Records how far this viewer has read one conversation. A plain write with
 * no cache invalidation, so a page can call it while rendering — revalidating
 * during a render is not allowed, and the server action wrapper does that part.
 */
export async function recordChatRead(viewer: ChatViewer, channelId: string) {
  const key = readerKeyFor(viewer);

  await prisma.chatRead.upsert({
    where: { channelId_readerKey: { channelId, readerKey: key } },
    create: { channelId, readerKey: key, employeeId: viewer.id, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

export type ChatMessageView = Awaited<ReturnType<typeof listMessages>>[number];

export type ConversationSummary = {
  conversation: Conversation;
  /** How the URL names it, from this viewer's side. */
  slug: string;
  title: string;
  subtitle: string | null;
  avatar: string;
  isGroup: boolean;
  last: LastMessage | null;
  unread: number;
};

type SummaryRow = {
  key: string;
  kind: ChatMessageKind | null;
  body: string | null;
  durationSeconds: number | null;
  attachmentName: string | null;
  authorName: string | null;
  authorType: string | null;
  authorId: string | null;
  createdAt: Date | null;
  unread: bigint;
};

// "Not something this viewer wrote", for counting what is unread.
function notMine(viewer: ChatViewer) {
  return viewer.type === "ADMIN"
    ? Prisma.sql`u."authorType" <> 'ADMIN'`
    : Prisma.sql`NOT (u."authorType" = 'EMPLOYEE' AND u."authorId" = ${viewer.id})`;
}

/**
 * The list of conversations this viewer has, WhatsApp-style: each with its
 * last message and how many are unread, in one query. The group first, then
 * the private conversations, the most recent first. For the manager that is
 * one per employee, whether or not anything has been said yet.
 */
export async function conversationsFor(viewer: ChatViewer): Promise<ConversationSummary[]> {
  const team = await getTeamChannel();
  const people =
    viewer.type === "ADMIN"
      ? await prisma.employee.findMany({
          where: { active: true, accessRole: "EMPLOYEE" },
          orderBy: { order: "asc" },
          select: { id: true, name: true, color: true, role: true },
        })
      : [];

  const keys =
    viewer.type === "ADMIN"
      ? [TEAM_CHANNEL_KEY, ...people.map((person) => directChannelKey(person.id))]
      : [TEAM_CHANNEL_KEY, directChannelKey(viewer.id)];

  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      c.key,
      lm.kind, lm.body, lm."durationSeconds", lm."attachmentName",
      lm."authorName", lm."authorType", lm."authorId", lm."createdAt",
      (
        SELECT COUNT(*) FROM "ChatMessage" u
        WHERE u."channelId" = c.id
          AND u."managerOnly" = false
          AND ${notMine(viewer)}
          AND u."createdAt" > COALESCE(r."lastReadAt", TIMESTAMP '-infinity')
      ) AS unread
    FROM "ChatChannel" c
    LEFT JOIN "ChatRead" r ON r."channelId" = c.id AND r."readerKey" = ${readerKeyFor(viewer)}
    LEFT JOIN LATERAL (
      SELECT m.kind, m.body, m."durationSeconds", m."attachmentName",
             m."authorName", m."authorType", m."authorId", m."createdAt"
      FROM "ChatMessage" m
      WHERE m."channelId" = c.id AND m."managerOnly" = false
      ORDER BY m."createdAt" DESC
      LIMIT 1
    ) lm ON true
    WHERE c.key IN (${Prisma.join(keys)})
  `;

  const byKey = new Map(rows.map((row) => [row.key, row]));

  const summarize = (key: string, base: Omit<ConversationSummary, "last" | "unread">): ConversationSummary => {
    const row = byKey.get(key);
    const last: LastMessage | null =
      row?.createdAt && row.kind
        ? {
            kind: row.kind,
            body: row.body,
            durationSeconds: row.durationSeconds,
            attachmentName: row.attachmentName,
            authorName: row.authorName ?? "",
            mine:
              viewer.type === "ADMIN"
                ? row.authorType === "ADMIN"
                : row.authorType === "EMPLOYEE" && row.authorId === viewer.id,
            createdAt: row.createdAt,
          }
        : null;
    return { ...base, last, unread: Number(row?.unread ?? 0) };
  };

  const group = summarize(TEAM_CHANNEL_KEY, {
    conversation: { kind: "team" },
    slug: "team",
    title: team.name,
    subtitle: null,
    avatar: GROUP_AVATAR,
    isGroup: true,
  });

  const direct =
    viewer.type === "ADMIN"
      ? people.map((person) =>
          summarize(directChannelKey(person.id), {
            conversation: { kind: "direct", employeeId: person.id },
            slug: person.id,
            title: person.name,
            subtitle: person.role,
            avatar: avatarUrl(person.name, person.color),
            isGroup: false,
          })
        )
      : [
          summarize(directChannelKey(viewer.id), {
            conversation: { kind: "direct", employeeId: viewer.id },
            slug: "manager",
            title: "Manager",
            subtitle: null,
            avatar: avatarUrl("Manager", "ink"),
            isGroup: false,
          }),
        ];

  // Sorting is stable, so people nobody has written to yet keep the team's order.
  direct.sort((a, b) => (b.last?.createdAt.getTime() ?? 0) - (a.last?.createdAt.getTime() ?? 0));

  return [group, ...direct];
}
