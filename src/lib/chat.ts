import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSessionEmployee } from "@/lib/employee-session";

// The team conversation, shared by the admin portal and the employee portal.
//
// Both sides read and write through here, so there is exactly one definition
// of who may see what: employees see the team's messages, and the manager
// additionally sees their own exchanges with the assistant.

export const TEAM_CHANNEL_KEY = "team";

export type ChatViewer =
  | { type: "ADMIN"; id: null; name: string }
  | { type: "EMPLOYEE"; id: string; name: string };

/**
 * Resolves whoever is asking from their session cookie. Never takes an
 * identity from the caller — an employee cannot claim to be the manager by
 * passing a different id.
 */
export async function getChatViewer(): Promise<ChatViewer | null> {
  const store = await cookies();

  if (verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    return { type: "ADMIN", id: null, name: "Manager" };
  }

  const employee = await getSessionEmployee();
  if (employee) return { type: "EMPLOYEE", id: employee.id, name: employee.name };

  return null;
}

export async function requireChatViewer(): Promise<ChatViewer> {
  const viewer = await getChatViewer();
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

// Assistant messages belong to the manager alone, so they are filtered out in
// the query rather than hidden in the UI.
function visibilityFilter(viewer: ChatViewer) {
  return viewer.type === "ADMIN" ? {} : { managerOnly: false };
}

const messageSelect = {
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

export async function listMessages(viewer: ChatViewer, take = 200) {
  const channel = await getTeamChannel();

  const messages = await prisma.chatMessage.findMany({
    where: { channelId: channel.id, ...visibilityFilter(viewer) },
    orderBy: { createdAt: "desc" },
    take,
    select: messageSelect,
  });

  // Newest first from the database so `take` keeps the most recent, oldest
  // first for reading.
  return messages.reverse();
}

/**
 * The conversation as the assistant sees it: the team's messages only, never
 * the manager's private exchanges with the assistant itself.
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

export async function unreadCount(viewer: ChatViewer) {
  const channel = await getTeamChannel();

  const read = await prisma.chatRead.findUnique({
    where: { channelId_readerKey: { channelId: channel.id, readerKey: readerKeyFor(viewer) } },
  });

  return prisma.chatMessage.count({
    where: {
      channelId: channel.id,
      ...visibilityFilter(viewer),
      createdAt: read ? { gt: read.lastReadAt } : undefined,
      // Your own messages are not news.
      NOT: { authorId: viewer.id ?? undefined, authorType: viewer.type },
    },
  });
}

/**
 * Records how far this viewer has read. A plain write with no cache
 * invalidation, so a page can call it while rendering — revalidating during a
 * render is not allowed, and the server action wrapper does that part.
 */
export async function recordChatRead(viewer: ChatViewer) {
  const channel = await getTeamChannel();
  const key = readerKeyFor(viewer);

  await prisma.chatRead.upsert({
    where: { channelId_readerKey: { channelId: channel.id, readerKey: key } },
    create: { channelId: channel.id, readerKey: key, employeeId: viewer.id, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

export type ChatMessageView = Awaited<ReturnType<typeof listMessages>>[number];
