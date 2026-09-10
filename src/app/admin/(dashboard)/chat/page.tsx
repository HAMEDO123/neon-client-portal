import { conversationsFor, requireChatViewer } from "@/lib/chat";
import { getTimezone } from "@/lib/settings";
import { ConversationList } from "@/components/chat/conversation-list";

// The manager's chats: the team's group, and a private conversation with each
// person on the team — started or not.

export default async function AdminChatsPage() {
  const viewer = await requireChatViewer("ADMIN");

  // One after the other, like the other multi-query pages here.
  const conversations = await conversationsFor(viewer);
  const timezone = await getTimezone();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Chat</h1>
      <p className="mt-1 text-sm text-ink/50">
        The team&apos;s group, and a private conversation with each person. A private chat is only between you and
        them.
      </p>

      <div className="glass mt-6 overflow-hidden rounded-2xl">
        <ConversationList items={conversations} basePath="/admin/chat" timeZone={timezone} />
      </div>
    </div>
  );
}
