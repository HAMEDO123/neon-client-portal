import { RpcError, bool, guarded, guardedAction, param, str, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";
import { prisma } from "@/lib/db";
import { channelFor, parseConversation, requireChatViewer } from "@/lib/chat";
import { taskListFor, taskMembers } from "@/lib/chat-task-store";
import { meetingListFor, meetingMembers } from "@/lib/chat-meeting-store";
import { reactionSnapshot } from "@/lib/chat-reaction-store";
import { memberKeyFor, setTyping } from "@/lib/presence-store";
import { createChatTask, deleteChatTask, addChatTaskComment } from "@/lib/actions/chat-task-actions";
import { createChatMeeting, cancelChatMeeting, setMeetingRsvp } from "@/lib/actions/chat-meeting-actions";
import { reactToMessage, setMessagePinned } from "@/lib/actions/chat-reaction-actions";
import { deleteChatMessage, askChatAssistant } from "@/lib/actions/chat-actions";
// The manager's approve / send-back on a task card — the same actions the
// web review queue calls, used here only as the card uses them.
import { approveSubmission, rejectSubmission } from "@/lib/actions/submission-actions";

// The "chat" area of the phone API. See lib/mobile/rpc.ts: keys are
// "chat/<name>"; every read is guarded(<the website page's guard>, …); an
// action calls the website's own server action, or is guardedAction(…) when
// it calls a lib function directly.
//
// Conversations, messages, reading a conversation and live updates are their
// own dedicated routes (chat/conversations, chat/messages, chat/read,
// chat/stream) rather than registry entries — chat.ts's own comment says a
// stream cannot be one, and the other three predate this file. What is here is
// everything else the web chat does: the Tasks and Meetings lists (the same
// pure `taskListFor` / `meetingListFor` the web's own tabs read), who a task or
// meeting in a conversation can go to, reactions and pins, typing, and the
// manager's assistant.

/**
 * Rebuilds a task-creation form so `createChatTask` sees an ordinary
 * repeated "assignee" field regardless of which transport it arrived on.
 * `performUpload` on the phone (multipart, used only when the task carries
 * a file) can send just one string per field, so it joins every assignee id
 * into "assignee" with commas; the JSON path never does this, so a value
 * with no comma — one id, or none — round-trips through here unchanged.
 */
function expandAssignees(form: FormData): FormData {
  const ids = form
    .getAll("assignee")
    .flatMap((value) => (typeof value === "string" ? value.split(",").map((id) => id.trim()).filter(Boolean) : []));
  if (ids.length <= 1) return form;

  const expanded = new FormData();
  for (const [key, value] of form.entries()) {
    if (key !== "assignee") expanded.append(key, value);
  }
  for (const id of ids) expanded.append("assignee", id);
  return expanded;
}

/** The conversation a request names, opened for this viewer — the same door every other read and action uses. */
async function openConversation(params: URLSearchParams, viewer: Awaited<ReturnType<typeof requireChatViewer>>) {
  const slug = param(params, "conversation");
  const conversation = parseConversation(slug, viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!conversation || !channel) throw new RpcError("That conversation is not yours.", 404);
  return channel;
}

export const reads: ReadRegistry = {
  // The chat list's Tasks tab, and the standalone Tasks view: the cards this
  // person can see, each with the conversation it lives in — open work first,
  // the soonest due on top, exactly as the web tab reads.
  "chat/tasks": guarded(requireChatViewer, async (_params, viewer) => ({ tasks: await taskListFor(viewer) })),

  // The Meetings tab: every card this person can see, what has not happened
  // yet first.
  "chat/meetings": guarded(requireChatViewer, async (_params, viewer) => ({ meetings: await meetingListFor(viewer) })),

  // Who a task or a meeting set in this conversation can go to — the manager
  // hands a task to any of these, and a meeting to any of these plus the
  // manager themself.
  "chat/members": guarded(requireChatViewer, async (params, viewer) => {
    const slug = param(params, "conversation");
    const conversation = parseConversation(slug, viewer);
    const channel = conversation ? await channelFor(viewer, conversation) : null;
    if (!conversation || !channel) throw new RpcError("That conversation is not yours.", 404);
    const [task, meeting] = await Promise.all([taskMembers(conversation), meetingMembers(conversation)]);
    return { task, meeting };
  }),

  // What people gave each message and what is pinned, for a screen that opened
  // without the live stream (or before its first snapshot arrives). The stream
  // sends this same shape as its own `reactions` event once connected.
  "chat/reactions": guarded(requireChatViewer, async (params, viewer) => {
    const channel = await openConversation(params, viewer);
    return reactionSnapshot(channel.id);
  }),

  // The composer's project picker — both conversation pages compute this
  // inline (the same query, admin and employee alike) rather than reading it
  // from a projects-area query, so it is reproduced here rather than adding a
  // dependency on that area's registry.
  "chat/projects": guarded(requireChatViewer, async () => ({
    projects: await prisma.project.findMany({
      where: { publishState: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
  })),
};

export const actions: ActionRegistry = {
  // An employee may delete only their own message; the manager may delete any
  // — deleteChatMessage carries that rule itself.
  "chat/messages/delete": (input) => deleteChatMessage(str(input.args[0], "messageId")),

  // Gives this person's reaction, or takes it back when it was already theirs.
  "chat/reactions/toggle": (input) => reactToMessage(str(input.args[0], "messageId"), str(input.args[1], "emoji")),

  // Lifts a message to the top of its conversation, or takes it down.
  "chat/pins/set": (input) => setMessagePinned(str(input.args[0], "messageId"), bool(input.args[1])),

  // "Wael is writing…": args[0] is the conversation's slug to start, or
  // NSNull() to say this person has stopped, wherever they were.
  "chat/typing": guardedAction(requireChatViewer, async (input, viewer) => {
    const raw = input.args[0];
    if (raw === null || raw === undefined) {
      await setTyping(memberKeyFor(viewer), null);
      return null;
    }
    const conversation = parseConversation(str(raw, "conversation"), viewer);
    const channel = conversation ? await channelFor(viewer, conversation) : null;
    if (!channel) throw new RpcError("That conversation is not yours.", 404);
    await setTyping(memberKeyFor(viewer), channel.id);
    return null;
  }),

  // Hands out work from a chat — the manager's + → Task. Its own guard refuses
  // anybody else. The JSON path already carries "assignee" as a repeated
  // field (an array in the phone's request becomes one form.append per id —
  // see do/[...name]/route.ts), which createChatTask reads with
  // formData.getAll("assignee") unchanged. An attachment forces multipart,
  // where the app's own upload helper sends one string per field, so a task
  // with a file joins every assignee id into that one field, comma-separated;
  // expandAssignees below splits it back out before the website's own action
  // ever sees the request, and leaves an ordinary single- or multi-assignee
  // JSON request untouched.
  "chat/tasks/create": (input) => createChatTask(expandAssignees(input.form)),
  "chat/tasks/delete": (input) => deleteChatTask(str(input.args[0], "taskId")),
  "chat/tasks/comment": (input) => addChatTaskComment(input.form),
  // The manager's approve / send-back on a card, exactly where the web review
  // queue's buttons lead — "Done" stays the manager's word either way.
  "chat/tasks/approve": (input) => approveSubmission(str(input.args[0], "submissionId"), input.form),
  "chat/tasks/reject": (input) => rejectSubmission(str(input.args[0], "submissionId"), input.form),

  // Sets, calls off, and answers a meeting — the manager's + → Meeting.
  "chat/meetings/create": (input) => createChatMeeting(input.form),
  "chat/meetings/cancel": (input) => cancelChatMeeting(str(input.args[0], "meetingId")),
  "chat/meetings/rsvp": (input) => setMeetingRsvp(input.form),

  // The manager's "Ask the assistant" panel. Its own guard refuses anybody else.
  "chat/assistant/ask": (input) => askChatAssistant(input.form),
};
