import { prisma } from "@/lib/db";
import { listMessages, recordChatRead, requireChatViewer } from "@/lib/chat";
import { isAiConfigured } from "@/lib/ai/client";
import { ChatRoom } from "@/components/chat/chat-room";
import { AssistantPanel } from "@/components/chat/assistant-panel";

export default async function AdminChatPage() {
  const viewer = await requireChatViewer();
  const [messages, projects] = await Promise.all([
    listMessages(viewer),
    prisma.project.findMany({
      where: { publishState: { not: "ARCHIVED" } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

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
        />
        <AssistantPanel configured={isAiConfigured()} />
      </div>
    </div>
  );
}
