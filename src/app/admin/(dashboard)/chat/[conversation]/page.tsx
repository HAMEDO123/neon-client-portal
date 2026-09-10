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
import { isAiConfigured } from "@/lib/ai/client";
import { getTimezone } from "@/lib/settings";
import { memberLine } from "@/lib/group-members";
import { avatarUrl } from "@/lib/avatar";
import { ChatRoom } from "@/components/chat/chat-room";
import { AssistantPanel } from "@/components/chat/assistant-panel";
import { ConversationList } from "@/components/chat/conversation-list";

// One conversation, filling the window: the team's group — with the manager's
// assistant under it — or a private chat with one person. On a wide screen the
// list of conversations stays beside it, so moving between them is one click.

export default async function AdminConversationPage({
  params,
}: {
  params: Promise<{ conversation: string }>;
}) {
  const viewer = await requireChatViewer("ADMIN");

  const { conversation: slug } = await params;
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

  return (
    // On a phone it is the whole screen, edge to edge, as a messaging app's is
    // (.chat-screen in globals.css); on a computer it sits in the page beside the list.
    <div className="chat-screen flex h-full gap-4 lg:p-6">
      <aside className="hidden w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-ink/10 bg-white/60 lg:flex">
        <p className="border-b border-ink/8 px-4 py-3 text-sm font-semibold text-ink">Chats</p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ConversationList items={conversations} basePath="/admin/chat" activeSlug={slug} timeZone={timezone} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:rounded-2xl lg:border lg:border-ink/10">
        <ChatRoom
          initialMessages={messages}
          viewerType="ADMIN"
          viewerId={null}
          canDeleteAny
          projects={projects}
          conversation={slug}
          showNames={group}
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
