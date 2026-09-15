"use server";

import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import {
  channelFor,
  chatSide,
  parseConversation,
  recordChatRead,
  requireChatViewer,
  type ChatViewer,
} from "@/lib/chat";
import { conversationFromKey, conversationSlug, employeeChatUrl, mayOpen } from "@/lib/chat-conversations";
import {
  TASK_COMMENT_MAX,
  TASK_DESCRIPTION_MAX,
  TASK_PRIORITIES,
  TASK_TITLE_MAX,
  dueLabel,
  mayComment,
  mayCreateTasks,
  readAssignees,
  readDue,
} from "@/lib/chat-tasks";
import {
  addChatTaskCommentRecord,
  chatTaskForAction,
  createChatTaskRecords,
  taskMembers,
} from "@/lib/chat-task-store";
import { dispatchNotification } from "@/lib/notifications/engine";
import { notifyAdmin } from "@/lib/admin-notifications";
import { avatarUrl } from "@/lib/avatar";
import { getTimezone } from "@/lib/settings";
import { dayKeyIn } from "@/lib/time";
import type { TaskPriority } from "@/generated/prisma/enums";

// Handing out work from a chat, and the thread under each card.
//
// Moving somebody's part of a task is deliberately not here. Each part is an
// ordinary AssignedTask, so the card calls the actions the week board and the
// job page already use — setMyAssignedTaskStatus and
// submitAssignedTaskCompletion for the person, setAssignedTaskState,
// approveSubmission and rejectSubmission for the manager — and keeps exactly
// their rules, their history and their notifications.
//
// Who is asking always comes from the session. A card is only ever reached
// through its conversation, and a conversation only through mayOpen.

const MANAGER_ICON = avatarUrl("Manager", "ink");

/** Where a notification about a card opens it on an employee's phone: the chat, scrolled to the card. */
function employeeCardUrl(channelKey: string, taskId: string, employeeId: string) {
  const conversation = conversationFromKey(channelKey);
  return conversation ? `${employeeChatUrl(conversation, employeeId)}?task=${taskId}` : "/employee/chat";
}

/** The same, for the manager. */
function adminCardUrl(channelKey: string, taskId: string) {
  const conversation = conversationFromKey(channelKey);
  const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };
  return conversation ? `/admin/chat/${conversationSlug(conversation, manager)}?task=${taskId}` : "/admin/chat";
}

function clip(text: string, length = 140) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export async function createChatTask(formData: FormData) {
  const viewer = await requireChatViewer("ADMIN");
  if (viewer.type !== "ADMIN") throw new Error("Only the manager hands out tasks.");

  const conversation = parseConversation(String(formData.get("conversation") ?? ""), viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!conversation || !channel || !mayCreateTasks(viewer, conversation)) {
    throw new Error("Tasks cannot be handed out in this chat.");
  }

  const title = String(formData.get("title") ?? "").trim().slice(0, TASK_TITLE_MAX);
  if (!title) throw new Error("Give the task a title.");
  const description = String(formData.get("description") ?? "").trim().slice(0, TASK_DESCRIPTION_MAX) || null;

  const priorityRaw = String(formData.get("priority") ?? "MEDIUM");
  const priority = TASK_PRIORITIES.includes(priorityRaw as TaskPriority) ? (priorityRaw as TaskPriority) : "MEDIUM";

  const members = await taskMembers(conversation);
  const assignees = readAssignees(
    formData.getAll("assignee").map(String),
    members.map((member) => member.id)
  );
  if (!assignees.ok) throw new Error(assignees.reason);

  const timezone = await getTimezone();
  const now = new Date();
  const due = readDue(String(formData.get("dueDay") ?? ""), String(formData.get("dueTime") ?? ""), timezone, now);
  if (!due.ok) throw new Error(due.reason);

  const file = formData.get("attachment");
  let attachment: { url: string; name: string; type: string | null; size: number | null } | null = null;
  if (file instanceof File && file.size > 0) {
    const image = file.type.startsWith("image/");
    const saved = await saveFile(file, image ? "chat/photos" : "chat/files", image ? "image" : "document");
    attachment = { url: saved.url, name: file.name || (image ? "Photo" : "File"), type: saved.fileType, size: saved.fileSize };
  }

  const created = await createChatTaskRecords({
    channelId: channel.id,
    authorName: viewer.name,
    title,
    description,
    dueAt: due.dueAt,
    dueDayKey: due.dayKey,
    todayKey: dayKeyIn(timezone, now),
    priority,
    assigneeIds: assignees.ids,
    attachment,
  });

  // Handing something out counts as having read everything before it.
  await recordChatRead(viewer, channel.id);

  // Telling people runs on its own, like a message: the card is on screen
  // already, and a failed push must never cost the task.
  const when = dueLabel(due.dueAt, now, timezone);
  void Promise.all(
    created.jobs.map((job) =>
      dispatchNotification({
        employeeId: job.employeeId,
        type: "TASK_ASSIGNED",
        title: "New task from the manager",
        message: clip(`${title}. Due ${when}.`),
        url: employeeCardUrl(channel.key, created.taskId, job.employeeId),
        icon: MANAGER_ICON,
        dedupeKey: `CHAT_TASK:${created.taskId}:${job.employeeId}`,
        metadata: { chatTaskId: created.taskId, assignedTaskId: job.id },
      }).catch(() => undefined)
    )
  );

  return created.message;
}

/**
 * Deleting a card deletes the task for everyone: the message, every person's
 * part of it with its photos and history, and the thread. Only the manager can,
 * and the people on it are told, because it also leaves their lists.
 */
export async function deleteChatTask(taskId: string) {
  const viewer = await requireChatViewer("ADMIN");
  if (viewer.type !== "ADMIN") throw new Error("Only the manager deletes tasks.");

  const task = await chatTaskForAction(taskId);
  if (!task) return;

  await prisma.chatMessage.delete({ where: { id: task.messageId } });

  await Promise.all(
    task.assignments.map((part) =>
      dispatchNotification({
        employeeId: part.employeeId,
        type: "TASK_UPDATED",
        title: "Task removed",
        message: clip(`The manager removed "${task.title}".`),
        url: "/employee/tasks",
        icon: MANAGER_ICON,
        dedupeKey: `CHAT_TASK_DELETED:${task.id}:${part.employeeId}`,
      }).catch(() => undefined)
    )
  );
}

/** A comment under a card, from the manager or one of the people the task was given to. */
export async function addChatTaskComment(formData: FormData) {
  const viewer = await requireChatViewer(chatSide(String(formData.get("as") ?? "")));

  const task = await chatTaskForAction(String(formData.get("taskId") ?? ""));
  if (!task) throw new Error("That task no longer exists.");

  const conversation = conversationFromKey(task.channel.key);
  const assigneeIds = task.assignments.map((part) => part.employeeId);
  if (!conversation || !mayOpen(viewer, conversation) || !mayComment(viewer, assigneeIds)) {
    throw new Error("Only the manager and the people on this task can comment on it.");
  }

  const body = String(formData.get("body") ?? "").trim().slice(0, TASK_COMMENT_MAX);
  if (!body) return null;

  const comment = await addChatTaskCommentRecord(task.id, viewer, body);

  // Everybody else on the card hears about it; nobody hears their own words.
  const heading = `${viewer.name} on "${clip(task.title, 60)}"`;
  void Promise.all([
    ...assigneeIds
      .filter((employeeId) => viewer.type === "ADMIN" || employeeId !== viewer.id)
      .map((employeeId) =>
        dispatchNotification({
          employeeId,
          type: "TASK_UPDATED",
          title: heading,
          message: clip(body),
          url: employeeCardUrl(task.channel.key, task.id, employeeId),
          icon: viewer.type === "ADMIN" ? MANAGER_ICON : undefined,
          dedupeKey: `CHAT_TASK_COMMENT:${comment.id}:${employeeId}`,
        }).catch(() => undefined)
      ),
    ...(viewer.type === "EMPLOYEE"
      ? [
          notifyAdmin({
            type: "CHAT_MESSAGE",
            title: heading,
            message: clip(body),
            url: adminCardUrl(task.channel.key, task.id),
            dedupeKey: `CHAT_TASK_COMMENT:${comment.id}:admin`,
            employeeId: viewer.id,
          }),
        ]
      : []),
  ]);

  return comment;
}
