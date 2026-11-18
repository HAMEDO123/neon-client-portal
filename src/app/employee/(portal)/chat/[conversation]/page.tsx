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
import { facesFor, keysInMessages } from "@/lib/faces";
import { isGroupConversation, otherPeer } from "@/lib/chat-conversations";
import { groupMemberNames } from "@/lib/chat-group-store";
import { memberLine } from "@/lib/group-members";
import { avatarUrl } from "@/lib/avatar";
import { getTimezone } from "@/lib/settings";
import { ChatRoom } from "@/components/chat/chat-room";
import { ConversationPanel } from "@/components/chat/studio/conversation-panel";
import { getSessionEmployee } from "@/lib/employee-session";
import { inboxSummary } from "@/lib/notifications/whatsapp-events";
import { whatsAppChatBase } from "@/lib/whatsapp-watch";

// One conversation, full screen: the team's group, the private chat with the
// manager, or a private chat with a colleague. Somebody else's private chat
// does not exist from here — the only names an employee can give one are
// "manager" and a colleague's id, and both always mean a chat they are in.
//
// `?task=` opens it at one task card: where a notification about a task, or
// the Tasks list, sends the employee.

export default async function EmployeeConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversation: string }>;
  searchParams: Promise<{ task?: string | string[] }>;
}) {
  const viewer = await requireChatViewer("EMPLOYEE");
  if (viewer.type !== "EMPLOYEE") throw new Error("Unauthorized");

  const { conversation: slug } = await params;
  const { task: focus } = await searchParams;
  const conversation = parseConversation(slug, viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!conversation || !channel) notFound();

  // One after the other, like the other multi-query pages here.
  const messages = await listMessages(viewer, channel.id);
  // Every face this screenful will draw, resolved once — see lib/faces.ts.
  // The people in the conversation are added to whoever has written, so a
  // first message arriving over the stream comes with its face.
  const faces = await facesFor([
    ...keysInMessages(messages),
    "admin",
    viewer.id,
    ...(conversation.kind === "peer" ? [otherPeer(conversation, viewer.id)] : []),
  ]);
  const projects = await prisma.project.findMany({
    where: { publishState: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });
  const team =
    conversation.kind === "team"
      ? await prisma.employee.findMany({
          where: { active: true, accessRole: "EMPLOYEE" },
          orderBy: { order: "asc" },
          select: { name: true },
        })
      : conversation.kind === "group"
        ? (await groupMemberNames(conversation.groupId)).map((name) => ({ name }))
        : [];
  const colleague =
    conversation.kind === "peer"
      ? await prisma.employee.findUnique({
          where: { id: otherPeer(conversation, viewer.id) },
          select: { name: true, color: true, photoUrl: true },
        })
      : null;
  const timezone = await getTimezone();

  await recordChatRead(viewer, channel.id);

  // The list beside the conversation on a desk, as the manager's chat has it
  // (the new UI, 2026-11-18). One query; the phone never draws it.
  const conversations = await conversationsFor(viewer);
  const me = await getSessionEmployee();
  const clients = me?.canReadWhatsApp ? await inboxSummary() : null;

  // The team, or a group the manager made: both are drawn as a group.
  const group = isGroupConversation(conversation);
  const withName = conversation.kind === "peer" ? (colleague?.name ?? channel.name) : "the manager";

  return (
    // Its own screen, WhatsApp-style: the conversation's header replaces the
    // portal's (.chat-screen in globals.css), and the messages scroll inside
    // the frame so the text box sits on the keyboard.
    <div className="chat-screen fills-frame wide-page flex overflow-hidden lg:gap-4 lg:p-5">
      <aside className="hidden w-[18rem] shrink-0 overflow-hidden rounded-3xl border border-warm-line bg-card shadow-[0_18px_40px_-30px_rgba(44,39,34,0.5)] lg:flex xl:w-[19rem]">
        <ConversationPanel
          items={conversations}
          basePath="/employee/chat"
          activeSlug={slug}
          timeZone={timezone}
          initialNow={new Date().getTime()}
          tasksHref="/employee/chat?view=tasks"
          whatsapp={clients ? { basePath: whatsAppChatBase("employee"), rows: clients.rows } : null}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card lg:rounded-3xl lg:border lg:border-warm-line lg:shadow-[0_18px_40px_-30px_rgba(44,39,34,0.5)]">
        <ChatRoom
          initialMessages={messages}
          faces={faces}
          viewerType="EMPLOYEE"
          viewerId={viewer.id}
          viewerName={viewer.name}
          canDeleteAny={false}
          projects={projects}
          conversation={slug}
          showNames={group}
          timeZone={timezone}
          initialNow={new Date().getTime()}
          focusTaskId={typeof focus === "string" ? focus : null}
          header={
            group
              ? {
                  name: channel.name,
                  subtitle: memberLine(["Manager", ...team.map((member) => member.name)], viewer.name),
                  backHref: "/employee/chat",
                }
              : conversation.kind === "peer"
                ? {
                    name: withName,
                    subtitle: `Private · only you and ${withName}`,
                    avatar: colleague?.photoUrl ?? avatarUrl(withName, colleague?.color),
                    backHref: "/employee/chat",
                  }
                : {
                    name: "Manager",
                    subtitle: "Private · only you and the manager",
                    avatar: faces.admin ?? avatarUrl("Manager", "ink"),
                    backHref: "/employee/chat",
                  }
          }
          emptyText={group ? undefined : `No messages yet. Only you and ${withName} can see this chat.`}
        />
      </div>
    </div>
  );
}
