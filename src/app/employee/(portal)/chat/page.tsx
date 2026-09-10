import { prisma } from "@/lib/db";
import { getTeamChannel, listMessages, recordChatRead, requireChatViewer } from "@/lib/chat";
import { memberLine } from "@/lib/group-members";
import { ChatRoom } from "@/components/chat/chat-room";

export default async function EmployeeChatPage() {
  const viewer = await requireChatViewer();
  if (viewer.type !== "EMPLOYEE") {
    // The admin has their own chat page; this one is the employee's.
    throw new Error("Unauthorized");
  }

  // One after the other, like the other multi-query pages here.
  const messages = await listMessages(viewer);
  const projects = await prisma.project.findMany({
    where: { publishState: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true },
  });
  const channel = await getTeamChannel();
  const team = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    orderBy: { order: "asc" },
    select: { name: true },
  });

  await recordChatRead(viewer);

  return (
    // Its own screen, WhatsApp-style: the group's header replaces the portal's
    // (.chat-screen in globals.css), and the conversation scrolls inside the
    // frame so the text box sits on the keyboard.
    <div className="chat-screen fills-frame flex flex-col overflow-hidden">
      <ChatRoom
        initialMessages={messages}
        viewerType="EMPLOYEE"
        viewerId={viewer.id}
        canDeleteAny={false}
        projects={projects}
        group={{
          name: channel.name,
          members: memberLine(["Manager", ...team.map((member) => member.name)], viewer.name),
          backHref: "/employee",
        }}
      />
    </div>
  );
}
