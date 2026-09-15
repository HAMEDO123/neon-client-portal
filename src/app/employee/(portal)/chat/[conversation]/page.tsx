import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { channelFor, listMessages, parseConversation, recordChatRead, requireChatViewer } from "@/lib/chat";
import { otherPeer } from "@/lib/chat-conversations";
import { memberLine } from "@/lib/group-members";
import { avatarUrl } from "@/lib/avatar";
import { ChatRoom } from "@/components/chat/chat-room";

// One conversation, full screen: the team's group, the private chat with the
// manager, or a private chat with a colleague. Somebody else's private chat
// does not exist from here — the only names an employee can give one are
// "manager" and a colleague's id, and both always mean a chat they are in.

export default async function EmployeeConversationPage({
  params,
}: {
  params: Promise<{ conversation: string }>;
}) {
  const viewer = await requireChatViewer("EMPLOYEE");
  if (viewer.type !== "EMPLOYEE") throw new Error("Unauthorized");

  const { conversation: slug } = await params;
  const conversation = parseConversation(slug, viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!conversation || !channel) notFound();

  // One after the other, like the other multi-query pages here.
  const messages = await listMessages(viewer, channel.id);
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
      : [];
  const colleague =
    conversation.kind === "peer"
      ? await prisma.employee.findUnique({
          where: { id: otherPeer(conversation, viewer.id) },
          select: { name: true, color: true },
        })
      : null;

  await recordChatRead(viewer, channel.id);

  const group = conversation.kind === "team";
  const withName = conversation.kind === "peer" ? (colleague?.name ?? channel.name) : "the manager";

  return (
    // Its own screen, WhatsApp-style: the conversation's header replaces the
    // portal's (.chat-screen in globals.css), and the messages scroll inside
    // the frame so the text box sits on the keyboard.
    <div className="chat-screen fills-frame flex flex-col overflow-hidden">
      <ChatRoom
        initialMessages={messages}
        viewerType="EMPLOYEE"
        viewerId={viewer.id}
        canDeleteAny={false}
        projects={projects}
        conversation={slug}
        showNames={group}
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
                  avatar: avatarUrl(withName, colleague?.color),
                  backHref: "/employee/chat",
                }
              : {
                  name: "Manager",
                  subtitle: "Private · only you and the manager",
                  avatar: avatarUrl("Manager", "ink"),
                  backHref: "/employee/chat",
                }
        }
        emptyText={group ? undefined : `No messages yet. Only you and ${withName} can see this chat.`}
      />
    </div>
  );
}
