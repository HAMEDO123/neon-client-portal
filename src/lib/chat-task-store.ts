import type { TaskPriority } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { messageSelect } from "@/lib/chat";
import { chatTaskSelect } from "@/lib/chat-task-select";
import {
  conversationFromKey,
  conversationSlug,
  mayOpen,
  type ChatViewer,
  type Conversation,
} from "@/lib/chat-conversations";
import { sortTaskList } from "@/lib/chat-tasks";
import { dayKeyToDate } from "@/lib/time";
import { daysBetween } from "@/lib/week";

// Task cards in the database: writing one together with every person's part of
// it, the thread under it, who in a conversation a task can go to, and what the
// live stream and the Tasks list read. The rules are chat-tasks.ts; the
// sessions and notifications are actions/chat-task-actions.ts.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have checked who is asking.

const memberSelect = { id: true, name: true, color: true } as const;

/**
 * The people a task in this conversation can go to: everyone on the team in
 * the group, the one person in a private chat with the manager, and nobody in
 * a chat between two employees.
 */
export async function taskMembers(conversation: Conversation) {
  if (conversation.kind === "peer") return [];
  return prisma.employee.findMany({
    where: {
      active: true,
      accessRole: "EMPLOYEE",
      ...(conversation.kind === "direct" ? { id: conversation.employeeId } : {}),
    },
    orderBy: { order: "asc" },
    select: memberSelect,
  });
}

export type TaskMember = Awaited<ReturnType<typeof taskMembers>>[number];

export type NewChatTask = {
  channelId: string;
  authorName: string;
  title: string;
  description: string | null;
  dueAt: Date;
  /** The calendar day of dueAt in the company's timezone. */
  dueDayKey: string;
  /** Today, in the company's timezone: the day each person's part starts. */
  todayKey: string;
  priority: TaskPriority;
  assigneeIds: string[];
  attachment: { url: string; name: string; type: string | null; size: number | null } | null;
};

/**
 * Writes the message, its card, and one AssignedTask for each person, all
 * together or not at all. A card that half exists — in the chat but on nobody's
 * list, or on somebody's list with no card — is worse than no card.
 *
 * Each part runs from today to the day it is due, so the week board and the
 * person's own list show it on the days it occupies, exactly like a job handed
 * out there.
 */
export async function createChatTaskRecords(input: NewChatTask) {
  const from = daysBetween(input.todayKey, input.dueDayKey) >= 0 ? input.todayKey : input.dueDayKey;

  return prisma.$transaction(async (tx) => {
    const message = await tx.chatMessage.create({
      data: {
        channelId: input.channelId,
        authorType: "ADMIN",
        authorName: input.authorName,
        kind: "TASK",
        // The title, so the chat list and a lock screen can say what it is.
        body: input.title,
      },
      select: { id: true },
    });

    const task = await tx.chatTask.create({
      data: {
        channelId: input.channelId,
        messageId: message.id,
        title: input.title,
        description: input.description,
        dueAt: input.dueAt,
        priority: input.priority,
        attachmentUrl: input.attachment?.url ?? null,
        attachmentName: input.attachment?.name ?? null,
        attachmentType: input.attachment?.type ?? null,
        attachmentSize: input.attachment?.size ?? null,
        assignments: {
          create: input.assigneeIds.map((employeeId) => ({
            employeeId,
            title: input.title,
            note: input.description,
            startDay: dayKeyToDate(from),
            endDay: dayKeyToDate(input.dueDayKey),
            priority: input.priority,
          })),
        },
      },
      select: { id: true, assignments: { select: { id: true, employeeId: true } } },
    });

    const saved = await tx.chatMessage.findUniqueOrThrow({ where: { id: message.id }, select: messageSelect });
    return { message: saved, taskId: task.id, jobs: task.assignments };
  });
}

/** A card with what deciding about it needs: where it is, and who is on it. */
export function chatTaskForAction(taskId: string) {
  return prisma.chatTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      messageId: true,
      channel: { select: { key: true } },
      assignments: { select: { id: true, employeeId: true } },
    },
  });
}

export function addChatTaskCommentRecord(taskId: string, author: ChatViewer, body: string) {
  return prisma.chatTaskComment.create({
    data: {
      chatTaskId: taskId,
      authorType: author.type,
      authorId: author.type === "EMPLOYEE" ? author.id : null,
      authorName: author.name,
      body,
    },
    select: chatTaskSelect.comments.select,
  });
}

export type ChatTaskComment = Awaited<ReturnType<typeof addChatTaskCommentRecord>>;

/**
 * Everything about one conversation's cards that can change without a new
 * message — a card added or deleted, somebody's part moving, a photo sent or
 * reviewed, a comment — folded into one string. The live stream sends the
 * cards again only when it moves.
 */
export async function taskSignature(channelId: string) {
  const rows = await prisma.$queryRaw<{ sig: string }[]>`
    SELECT concat_ws('.',
      (SELECT COUNT(*) FROM "ChatTask" WHERE "channelId" = ${channelId}),
      (SELECT COALESCE(EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000, 0)::bigint FROM "ChatTask" WHERE "channelId" = ${channelId}),
      (SELECT COUNT(*) FROM "AssignedTask" a JOIN "ChatTask" t ON t.id = a."chatTaskId" WHERE t."channelId" = ${channelId}),
      (SELECT COALESCE(EXTRACT(EPOCH FROM MAX(a."updatedAt")) * 1000, 0)::bigint
         FROM "AssignedTask" a JOIN "ChatTask" t ON t.id = a."chatTaskId" WHERE t."channelId" = ${channelId}),
      (SELECT COUNT(*) FROM "ChatTaskComment" c JOIN "ChatTask" t ON t.id = c."chatTaskId" WHERE t."channelId" = ${channelId}),
      (SELECT COUNT(*) FROM "TaskSubmission" s
         JOIN "AssignedTask" a ON a.id = s."assignedTaskId"
         JOIN "ChatTask" t ON t.id = a."chatTaskId"
         WHERE t."channelId" = ${channelId} AND s.status = 'PENDING')
    ) AS sig
  `;
  return rows[0]?.sig ?? "";
}

/**
 * The cards of one conversation as they stand: every card's id — so a deleted
 * one can be taken off the screen — and the newest hundred in full. `at` is
 * taken before either is read, so a screen can tell a card that is missing
 * because it was deleted from one created after the snapshot was taken.
 */
export async function taskSnapshot(channelId: string) {
  const at = Date.now();
  const ids = await prisma.chatTask.findMany({ where: { channelId }, select: { id: true } });
  const tasks = await prisma.chatTask.findMany({
    where: { channelId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: chatTaskSelect,
  });
  return { at, ids: ids.map((row) => row.id), tasks };
}

export type ChatTaskView = Awaited<ReturnType<typeof taskSnapshot>>["tasks"][number];

const listSelect = {
  id: true,
  messageId: true,
  title: true,
  dueAt: true,
  priority: true,
  createdAt: true,
  assignments: {
    orderBy: { createdAt: "asc" },
    select: { id: true, employeeId: true, state: true, employee: { select: { name: true, color: true } } },
  },
  _count: { select: { comments: true } },
  channel: { select: { key: true, name: true } },
} as const;

/**
 * The Tasks list. For the manager, every task handed out in a chat; for an
 * employee, the ones they are on. Each with the conversation it lives in, as
 * this viewer names it, and in the order the list reads: open work first,
 * soonest due on top.
 */
export async function taskListFor(viewer: ChatViewer) {
  const rows = await prisma.chatTask.findMany({
    where: viewer.type === "ADMIN" ? {} : { assignments: { some: { employeeId: viewer.id } } },
    orderBy: { dueAt: "desc" },
    take: 300,
    select: listSelect,
  });

  const items = rows.flatMap(({ channel, ...task }) => {
    const conversation = conversationFromKey(channel.key);
    // The same door as every other read: a card is listed only for somebody who may open its chat.
    if (!conversation || !mayOpen(viewer, conversation)) return [];
    return [
      {
        ...task,
        conversationSlug: conversationSlug(conversation, viewer),
        conversationTitle: conversation.kind === "direct" && viewer.type === "EMPLOYEE" ? "Manager" : channel.name,
        isGroup: conversation.kind === "team",
      },
    ];
  });

  return sortTaskList(items);
}

export type TaskListItem = Awaited<ReturnType<typeof taskListFor>>[number];
