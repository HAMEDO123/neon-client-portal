import { prisma } from "@/lib/db";
import { listMessages, recordChatRead, requireChatViewer } from "@/lib/chat";
import { ChatRoom } from "@/components/chat/chat-room";

export default async function EmployeeChatPage() {
  const viewer = await requireChatViewer();
  if (viewer.type !== "EMPLOYEE") {
    // The admin has their own chat page; this one is the employee's.
    throw new Error("Unauthorized");
  }

  const [messages, projects] = await Promise.all([
    listMessages(viewer),
    prisma.project.findMany({
      where: { publishState: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  await recordChatRead(viewer);

  return (
    // Fills the space between the app header and the tab bar, so the composer
    // sits just above the thumb rather than below the fold.
    <div className="-mx-4 -mt-5 flex h-[calc(100dvh-9.5rem)] flex-col overflow-hidden">
      <ChatRoom
        initialMessages={messages}
        viewerType="EMPLOYEE"
        viewerId={viewer.id}
        canDeleteAny={false}
        projects={projects}
      />
    </div>
  );
}
