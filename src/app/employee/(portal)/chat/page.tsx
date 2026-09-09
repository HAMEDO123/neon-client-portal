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
    // Pinned rather than laid out in the page: the screen itself must not
    // scroll, or the keyboard opening drags the whole conversation upward and
    // leaves the tab bar floating. Only the message list inside moves. The
    // bottom sits above the tab bar, or above the keyboard when it is open —
    // both are variables the layout keeps up to date.
    <div
      className="fixed inset-x-0 z-20 flex flex-col overflow-hidden"
      style={{
        top: "var(--employee-header)",
        bottom: "calc(var(--employee-nav) + var(--keyboard-inset))",
      }}
    >
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
