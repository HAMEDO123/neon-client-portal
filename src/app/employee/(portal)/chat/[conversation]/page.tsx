import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { channelFor, listMessages, parseConversation, recordChatRead, requireChatViewer } from "@/lib/chat";
import { memberLine } from "@/lib/group-members";
import { avatarUrl } from "@/lib/avatar";
import { ChatRoom } from "@/components/chat/chat-room";

// One conversation, full screen: the team's group, or the private chat with
// the manager. Somebody else's private chat does not exist from here — the
// only name an employee can give one is "manager", which is always their own.

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

  await recordChatRead(viewer, channel.id);

  const group = conversation.kind === "team";

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
            : {
                name: "Manager",
                subtitle: "Private · only you and the manager",
                avatar: avatarUrl("Manager", "ink"),
                backHref: "/employee/chat",
              }
        }
        emptyText={group ? undefined : "No messages yet. Only you and the manager can see this chat."}
      />
    </div>
  );
}
