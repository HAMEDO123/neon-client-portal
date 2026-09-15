import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  channelFor,
  conversationsFor,
  listMessages,
  parseConversation,
  recordChatRead,
  requireChatViewer,
} from "@/lib/chat";
import { taskListFor, taskMembers } from "@/lib/chat-task-store";
import { defaultDue, isOverdue, mayCreateTasks, progressOf } from "@/lib/chat-tasks";
import { isAiConfigured } from "@/lib/ai/client";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { dayKeyIn } from "@/lib/time";
import { memberLine } from "@/lib/group-members";
import { avatarUrl } from "@/lib/avatar";
import { ChatRoom } from "@/components/chat/chat-room";
import { AssistantPanel } from "@/components/chat/assistant-panel";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ConversationList } from "@/components/chat/conversation-list";
import { TaskList } from "@/components/chat/task-list";

// One conversation, filling the window: the team's group — with the manager's
// assistant under it — or a private chat with one person. On a wide screen the
// chats and the tasks stay beside it, so moving between them is one click.
//
// `?task=` opens it at one task card.

export default async function AdminConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversation: string }>;
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const viewer = await requireChatViewer("ADMIN");

  const { conversation: slug } = await params;
  const { task: focus } = await searchParams;
  const conversation = parseConversation(slug, viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!conversation || !channel) notFound();

  // Opening it is reading it — first, so the list beside it agrees.
  await recordChatRead(viewer, channel.id);

  // One after the other, like the other multi-query pages here.
  const messages = await listMessages(viewer, channel.id);
  const projects = await prisma.project.findMany({
    where: { publishState: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });
  const conversations = await conversationsFor(viewer);
  const tasks = await taskListFor(viewer);
  const timezone = await getTimezone();

  const group = conversation.kind === "team";
  const team = group
    ? await prisma.employee.findMany({
        where: { active: true, accessRole: "EMPLOYEE" },
        orderBy: { order: "asc" },
        select: { name: true },
      })
    : [];
  const person =
    conversation.kind === "direct"
      ? await prisma.employee.findUnique({
          where: { id: conversation.employeeId },
          select: { name: true, color: true },
        })
      : null;
  const personName = person?.name ?? channel.name;

  const now = new Date();
  const taskSetup = mayCreateTasks(viewer, conversation)
    ? {
        members: await taskMembers(conversation),
        defaultDue: defaultDue(await getWorkHours(), timezone, now),
        today: dayKeyIn(timezone, now),
        timeZone: timezone,
      }
    : null;

  const open = tasks.filter((task) => !progressOf(task.assignments).complete);
  const late = open.filter((task) => isOverdue(task.dueAt, task.assignments, now.getTime()));

  return (
    // On a phone it is the whole screen, edge to edge, as a messaging app's is
    // (.chat-screen in globals.css); on a computer it sits in the page beside the list.
    <div className="chat-screen flex h-full gap-4 lg:p-6">
      <aside className="hidden w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white/60 lg:flex">
        <ChatSidebar
          className="flex min-h-0 flex-1 flex-col"
          tabsClassName="m-3 mb-2"
          panelClassName="min-h-0 flex-1 overflow-y-auto border-t border-ink/8"
          openTasks={open.length}
          lateTasks={late.length}
          chats={<ConversationList items={conversations} basePath="/admin/chat" activeSlug={slug} timeZone={timezone} />}
          tasks={
            <TaskList
              items={tasks}
              basePath="/admin/chat"
              timeZone={timezone}
              initialNow={now.getTime()}
              emptyText="Hand out a task from a chat with + or by typing /task."
            />
          }
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:rounded-2xl lg:border lg:border-ink/10">
        <ChatRoom
          initialMessages={messages}
          viewerType="ADMIN"
          viewerId={null}
          viewerName={viewer.name}
          canDeleteAny
          projects={projects}
          conversation={slug}
          showNames={group}
          timeZone={timezone}
          initialNow={now.getTime()}
          taskSetup={taskSetup}
          focusTaskId={typeof focus === "string" ? focus : null}
          header={
            group
              ? {
                  name: channel.name,
                  subtitle: memberLine(["Manager", ...team.map((member) => member.name)], "Manager"),
                  backHref: "/admin/chat",
                }
              : {
                  name: personName,
                  subtitle: `Private · only you and ${personName}`,
                  avatar: avatarUrl(personName, person?.color),
                  backHref: "/admin/chat",
                }
          }
          emptyText={group ? undefined : `No messages yet. Only you and ${personName} can see this chat.`}
        />
        {group && <AssistantPanel configured={isAiConfigured()} />}
      </div>
    </div>
  );
}
