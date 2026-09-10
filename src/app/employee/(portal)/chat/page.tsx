import { conversationsFor, requireChatViewer } from "@/lib/chat";
import { getTimezone } from "@/lib/settings";
import { ConversationList } from "@/components/chat/conversation-list";

// The employee's chats: the team's group, and their private conversation with
// the manager — the only two they have.

export default async function EmployeeChatsPage() {
  const viewer = await requireChatViewer("EMPLOYEE");
  if (viewer.type !== "EMPLOYEE") {
    // The admin has their own chat pages; these are the employee's.
    throw new Error("Unauthorized");
  }

  // One after the other, like the other multi-query pages here.
  const conversations = await conversationsFor(viewer);
  const timezone = await getTimezone();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">Chats</h1>

      <div className="glass overflow-hidden rounded-2xl">
        <ConversationList items={conversations} basePath="/employee/chat" timeZone={timezone} />
      </div>

      <p className="px-4 text-center text-xs text-ink/40">
        Your chat with the manager is private: only the two of you can see it.
      </p>
    </div>
  );
}
