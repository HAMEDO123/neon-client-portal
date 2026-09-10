import { prisma } from "@/lib/db";
import { getTeamChannel, listMessages, recordChatRead, requireChatViewer } from "@/lib/chat";
import { isAiConfigured } from "@/lib/ai/client";
import { memberLine } from "@/lib/group-members";
import { ChatRoom } from "@/components/chat/chat-room";
import { AssistantPanel } from "@/components/chat/assistant-panel";

export default async function AdminChatPage() {
  const viewer = await requireChatViewer();

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

  // Opening the page is reading it.
  await recordChatRead(viewer);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Team Chat</h1>
      <p className="mt-1 text-sm text-ink/50">
        Everyone on the team is in here. Send updates, photos from site and voice notes.
      </p>

      <div className="mt-6 flex h-[calc(100dvh-16rem)] min-h-96 flex-col overflow-hidden rounded-2xl border border-ink/10">
        <ChatRoom
          initialMessages={messages}
          viewerType="ADMIN"
          viewerId={null}
          canDeleteAny
          projects={projects}
          group={{
            name: channel.name,
            members: memberLine(["Manager", ...team.map((member) => member.name)], "Manager"),
          }}
        />
        <AssistantPanel configured={isAiConfigured()} />
      </div>
    </div>
  );
}
