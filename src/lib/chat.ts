import { Prisma } from "@/generated/prisma/client";
import type { ChatMessageKind } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { hasAdminSession } from "@/lib/session-token";
import { getSessionEmployee } from "@/lib/employee-session";
import { avatarUrl } from "@/lib/avatar";
import { chatTaskSelect } from "@/lib/chat-task-select";
import { chatMeetingSelect } from "@/lib/chat-meeting-select";
import {
  GROUP_AVATAR,
  TEAM_CHANNEL_KEY,
  directChannelKey,
  groupChannelKey,
  groupSlug,
  mayOpen,
  otherPeer,
  peerChannelKey,
  peerConversation,
  peerKeyPatterns,
  type ChatSide,
  type ChatViewer,
  type Conversation,
  type LastMessage,
} from "@/lib/chat-conversations";
import { getGroupChannel, groupsFor } from "@/lib/chat-group-store";
import { prefsFor } from "@/lib/chat-pref-store";
import { DEFAULT_PREFS, orderConversations } from "@/lib/chat-prefs";
import { STREAK_LOOKBACK_DAYS, chatStreak, type ChatStreak } from "@/lib/chat-streaks";
import { presenceFor } from "@/lib/presence-store";
import { isOnline } from "@/lib/presence";
import { getTimezone } from "@/lib/settings";
import { dayKeyIn } from "@/lib/time";

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
// One team conversation everybody is in, one private conversation between the
// manager and each employee, and one between any two employees. Both portals
// read and write through here, and every read and write finds its channel
// through channelFor — so there is exactly one definition of who may see what:
// an employee sees the team, their own chat with the manager and their own
// chats with colleagues, never anybody else's; the manager sees the team and
// every chat with the manager, plus their own exchanges with the assistant in
// the team conversation, and never a chat between two employees. Groups the
// manager made are open to the manager and to their members
// (chat-group-store.ts).

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
  if (side !== "EMPLOYEE" && (await hasAdminSession())) {
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
 * The private conversation between two employees, created the first time
 * either of them opens it, and only while both are on the team. Once it exists
 * it stays readable to both, so somebody leaving does not take the history of
 * what was said with them.
 */
async function getPeerChannel([first, second]: [string, string]) {
  const key = peerChannelKey(first, second);
  const existing = await prisma.chatChannel.findUnique({ where: { key } });
  if (existing) return existing;

  const people = await prisma.employee.findMany({
    where: { id: { in: [first, second] }, active: true, accessRole: "EMPLOYEE" },
    orderBy: { order: "asc" },
    select: { name: true },
  });
  if (people.length !== 2) return null;

  try {
    return await prisma.chatChannel.create({ data: { key, name: people.map((person) => person.name).join(" & ") } });
  } catch {
    // Both of them opened it at once; the other request made it.
    return prisma.chatChannel.findUnique({ where: { key } });
  }
}

/**
 * The channel behind a conversation, or null when this viewer may not open it.
 * The rule itself is mayOpen, in chat-conversations.ts.
 */
export async function channelFor(viewer: ChatViewer, conversation: Conversation) {
  // A group's members live in the database, so its door reads them itself.
  if (conversation.kind === "group") return getGroupChannel(viewer, conversation.groupId);
  if (!mayOpen(viewer, conversation)) return null;
  if (conversation.kind === "team") return getTeamChannel();
  if (conversation.kind === "direct") return getDirectChannel(conversation.employeeId);
  return getPeerChannel(conversation.employeeIds);
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
  // A task message carries its card, so it arrives drawn rather than as a blank to fill in.
  task: { select: chatTaskSelect },
  // The line a call left: what kind of call, and how it ended.
  call: { select: { kind: true, endReason: true } },
  // A meeting message carries its card too, for the same reason a task does.
  meeting: { select: chatMeetingSelect },
  // Whether this one has been lifted to the top of the conversation, and by whom.
  pinnedAt: true,
  pinnedByName: true,
} as const;

// Reactions are deliberately NOT read here, though they belong to a message.
//
// This select already reads four relations — the project, a task card, a call
// and a meeting card, the last two of them deeply nested — and a fifth closes
// the local `prisma dev` connection outright: "Server has closed the
// connection" on every call, from a database that answers a plain query at the
// same moment. It reads exactly like a dead database and is not one.
//
// It was measured rather than reasoned about: the pinned scalars above are
// free, the reactions relation on its own is free, that relation with an
// orderBy is free — and only all five together fall over. So the limit is the
// number of relations in one read, not anything about reactions.
//
// Fetching them beside a message is the better shape anyway. A reaction
// changes without the message changing, so it travels as its own event on the
// live stream and is read by reactionSnapshot in chat-reaction-store.ts, while
// every other caller of this select — notifications, the conversation list,
// the assistant's read of the team chat — has no use for them at all.

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
  /** This viewer's own settings for it (chat-prefs.ts). */
  pinned: boolean;
  muted: boolean;
  favorite: boolean;
  /** Days in a row both people wrote (chat-streaks.ts). Private chats only; null for none. */
  streak: ChatStreak | null;
  /** Whether the other person has the platform open now. Private chats only. */
  online: boolean | null;
  /** How many people are in it, the manager included. The team and groups only. */
  memberCount: number | null;
};

type SummaryRow = {
  id: string;
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
 * The people a private chat can be with, from this viewer's side. For the
 * manager, everybody on the team. For an employee, every colleague — and also
 * a colleague who has since left, when there is already a conversation with
 * them, so what was said stays findable and its unread count can be cleared.
 */
async function chatPartners(viewer: ChatViewer) {
  const select = { id: true, name: true, color: true, role: true, active: true } as const;

  if (viewer.type === "ADMIN") {
    return prisma.employee.findMany({
      where: { active: true, accessRole: "EMPLOYEE" },
      orderBy: { order: "asc" },
      select,
    });
  }

  const [peerFirst, peerSecond] = peerKeyPatterns(viewer.id);
  const existing = await prisma.$queryRaw<{ key: string }[]>`
    SELECT key FROM "ChatChannel" WHERE key LIKE ${peerFirst} OR key LIKE ${peerSecond}
  `;
  const pastIds = existing
    .map((row) => row.key.split(":").slice(1))
    .map(([first, second]) => (first === viewer.id ? second : first));

  return prisma.employee.findMany({
    where: {
      accessRole: "EMPLOYEE",
      NOT: { id: viewer.id },
      OR: [{ active: true }, { id: { in: pastIds } }],
    },
    orderBy: { order: "asc" },
    select,
  });
}

/**
 * Every private chat's streak, by channel key: one query that returns, per
 * conversation, the studio-calendar days on which both of its people wrote
 * something other than a call's line. The rule that turns those days into a
 * number is chatStreak, in chat-streaks.ts.
 */
async function streaksByKey(keys: string[], now: Date) {
  const result = new Map<string, ChatStreak>();
  if (keys.length === 0) return result;

  const timeZone = await getTimezone();
  const since = new Date(now.getTime() - (STREAK_LOOKBACK_DAYS + 2) * 86_400_000);
  const rows = await prisma.$queryRaw<{ key: string; day: string }[]>`
    SELECT c.key, to_char((m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day
    FROM "ChatMessage" m
    JOIN "ChatChannel" c ON c.id = m."channelId"
    WHERE c.key IN (${Prisma.join(keys)})
      AND m.kind <> 'CALL'
      AND m."managerOnly" = false
      AND m."authorType" IN ('ADMIN', 'EMPLOYEE')
      AND m."createdAt" >= ${since}
    GROUP BY 1, 2
    HAVING COUNT(DISTINCT CASE WHEN m."authorType" = 'ADMIN' THEN 'admin' ELSE m."authorId" END) >= 2
  `;

  const daysByKey = new Map<string, string[]>();
  for (const row of rows) {
    const days = daysByKey.get(row.key) ?? [];
    days.push(row.day);
    daysByKey.set(row.key, days);
  }

  const today = dayKeyIn(timeZone, now);
  for (const [key, days] of daysByKey) {
    const streak = chatStreak(days, today);
    if (streak) result.set(key, streak);
  }
  return result;
}

/** The person on the other side of a private chat, by the key presence is kept under. */
function otherMemberKey(viewer: ChatViewer, conversation: Conversation) {
  if (conversation.kind === "direct") return viewer.type === "ADMIN" ? conversation.employeeId : "admin";
  if (conversation.kind === "peer") return otherPeer(conversation, viewer.id ?? "");
  return null;
}

/**
 * The list of conversations this viewer has, WhatsApp-style: each with its
 * last message and how many are unread, in one query. The team, the groups this
 * viewer is in, and the private conversations — for the manager one per
 * employee, for an employee the manager and one per colleague, whether or not
 * anything has been said yet. Each carries this viewer's own settings, a
 * private chat's streak and whether the other person is here, and a group's
 * size.
 *
 * The order is chat-prefs.ts's: what this viewer pinned first, then the rest
 * by their last message, newest first.
 */
export async function conversationsFor(viewer: ChatViewer): Promise<ConversationSummary[]> {
  const now = new Date();
  const team = await getTeamChannel();
  const people = await chatPartners(viewer);
  const groups = await groupsFor(viewer);

  const privateKeys =
    viewer.type === "ADMIN"
      ? people.map((person) => directChannelKey(person.id))
      : [directChannelKey(viewer.id), ...people.map((person) => peerChannelKey(viewer.id, person.id))];
  const keys = [TEAM_CHANNEL_KEY, ...groups.map((group) => groupChannelKey(group.id)), ...privateKeys];

  const rows = await prisma.$queryRaw<SummaryRow[]>`
    SELECT
      c.id, c.key,
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
  const prefs = await prefsFor(
    readerKeyFor(viewer),
    rows.map((row) => row.id)
  );
  const streaks = await streaksByKey(
    privateKeys.filter((key) => byKey.has(key)),
    now
  );
  const teamSize = (await prisma.employee.count({ where: { active: true, accessRole: "EMPLOYEE" } })) + 1;

  type Base = Omit<
    ConversationSummary,
    "last" | "unread" | "pinned" | "muted" | "favorite" | "streak" | "online" | "memberCount"
  >;
  const bases: { key: string; base: Base; memberCount: number | null }[] = [
    {
      key: TEAM_CHANNEL_KEY,
      base: { conversation: { kind: "team" }, slug: "team", title: team.name, subtitle: null, avatar: GROUP_AVATAR, isGroup: true },
      memberCount: teamSize,
    },
    ...groups.map((group) => ({
      key: groupChannelKey(group.id),
      base: {
        conversation: { kind: "group", groupId: group.id } as Conversation,
        slug: groupSlug(group.id),
        title: group.name,
        subtitle: null,
        avatar: group.avatar,
        isGroup: true,
      },
      memberCount: group.memberCount,
    })),
    ...(viewer.type === "ADMIN"
      ? people.map((person) => ({
          key: directChannelKey(person.id),
          base: {
            conversation: { kind: "direct", employeeId: person.id } as Conversation,
            slug: person.id,
            title: person.name,
            subtitle: person.role,
            avatar: avatarUrl(person.name, person.color),
            isGroup: false,
          },
          memberCount: null,
        }))
      : [
          {
            key: directChannelKey(viewer.id),
            base: {
              conversation: { kind: "direct", employeeId: viewer.id } as Conversation,
              slug: "manager",
              title: "Manager",
              subtitle: null,
              avatar: avatarUrl("Manager", "ink"),
              isGroup: false,
            },
            memberCount: null,
          },
          ...people.map((person) => ({
            key: peerChannelKey(viewer.id, person.id),
            base: {
              conversation: peerConversation(viewer.id, person.id) as Conversation,
              slug: person.id,
              title: person.name,
              subtitle: person.active ? person.role : "No longer on the team",
              avatar: avatarUrl(person.name, person.color),
              isGroup: false,
            },
            memberCount: null,
          })),
        ]),
  ];

  const otherKeys = bases.flatMap(({ base }) => {
    const other = otherMemberKey(viewer, base.conversation);
    return other ? [other] : [];
  });
  const seen = await presenceFor(otherKeys);

  const summaries = bases.map(({ key, base, memberCount }): ConversationSummary => {
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
    const other = otherMemberKey(viewer, base.conversation);
    const settings = (row && prefs.get(row.id)) ?? DEFAULT_PREFS;
    return {
      ...base,
      last,
      unread: Number(row?.unread ?? 0),
      pinned: settings.pinned,
      muted: settings.muted,
      favorite: settings.favorite,
      streak: other ? (streaks.get(key) ?? null) : null,
      online: other ? isOnline(seen.get(other), now.getTime()) : null,
      memberCount: base.isGroup ? memberCount : null,
    };
  });

  return orderConversations(summaries);
}
