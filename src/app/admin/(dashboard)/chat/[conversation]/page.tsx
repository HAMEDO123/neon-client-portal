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
import { taskMembers } from "@/lib/chat-task-store";
import { defaultDue, mayCreateTasks } from "@/lib/chat-tasks";
import { projectPanelFor } from "@/lib/chat-project-panel";
import { isAiConfigured } from "@/lib/ai/client";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { dayKeyIn } from "@/lib/time";
import { memberLine } from "@/lib/group-members";
import { avatarUrl } from "@/lib/avatar";
import { ChatRoom } from "@/components/chat/chat-room";
import { AssistantPanel } from "@/components/chat/assistant-panel";
import { ConversationPanel } from "@/components/chat/studio/conversation-panel";
import { ProjectPanelCard } from "@/components/chat/studio/project-panel";

// The studio's chat, as three columns: the conversations on the left, the one
// that is open in the middle, and on the right the project it is about — its
// newest files and where its steps stand.
//
// On a phone it is the middle column alone, edge to edge (.chat-screen in
// globals.css), which is the same screen the employees' portal uses.
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
  const panel = await projectPanelFor(channel.id);
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

  return (
    <div className="chat-screen flex h-full gap-4 bg-paper lg:p-5">
      <aside className="hidden w-[18rem] shrink-0 overflow-hidden rounded-3xl border border-warm-line bg-card shadow-[0_18px_40px_-30px_rgba(44,39,34,0.5)] lg:flex xl:w-[19rem]">
        <ConversationPanel
          items={conversations}
          basePath="/admin/chat"
          activeSlug={slug}
          timeZone={timezone}
          initialNow={now.getTime()}
          tasksHref="/admin/chat?view=tasks"
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-warm-line bg-card lg:rounded-3xl lg:border lg:shadow-[0_18px_40px_-30px_rgba(44,39,34,0.5)]">
        <ChatRoom
          variant="studio"
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

      {/* The project beside the talk. The first thing to go when the window
          narrows: the conversation matters more than the panel about it, and
          three columns on a 1280-wide screen leave the middle one unreadable. */}
      <aside className="hidden w-[19rem] shrink-0 overflow-y-auto 2xl:block">
        <ProjectPanelCard panel={panel} timeZone={timezone} initialNow={now.getTime()} />
      </aside>
    </div>
  );
}
