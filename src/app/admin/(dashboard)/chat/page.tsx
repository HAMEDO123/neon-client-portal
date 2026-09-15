import { conversationsFor, requireChatViewer } from "@/lib/chat";
import { taskListFor } from "@/lib/chat-task-store";
import { isOverdue, progressOf } from "@/lib/chat-tasks";
import { getTimezone } from "@/lib/settings";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ConversationList } from "@/components/chat/conversation-list";
import { TaskList } from "@/components/chat/task-list";

// The manager's chats — the team's group, and a private conversation with each
// person on the team, started or not — and, on the other tab, every task handed
// out in a chat. `?view=tasks` opens on that tab.

export default async function AdminChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const viewer = await requireChatViewer("ADMIN");

  // One after the other, like the other multi-query pages here.
  const conversations = await conversationsFor(viewer);
  const tasks = await taskListFor(viewer);
  const timezone = await getTimezone();
  const { view } = await searchParams;

  const now = new Date().getTime();
  const open = tasks.filter((task) => !progressOf(task.assignments).complete);
  const late = open.filter((task) => isOverdue(task.dueAt, task.assignments, now));

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Chat</h1>
      <p className="mt-1 text-sm text-ink/50">
        The team&apos;s group, and a private conversation with each person. A private chat is only between you and
        them. Hand out a task from any of them with + or by typing /task.
      </p>

      <ChatSidebar
        className="mt-6 flex max-w-2xl flex-col gap-3"
        initialTab={view === "tasks" ? "tasks" : "chats"}
        openTasks={open.length}
        lateTasks={late.length}
        chats={
          <div className="glass overflow-hidden rounded-2xl">
            <ConversationList items={conversations} basePath="/admin/chat" timeZone={timezone} />
          </div>
        }
        tasks={
          <div className="glass overflow-hidden rounded-2xl">
            <TaskList
              items={tasks}
              basePath="/admin/chat"
              timeZone={timezone}
              initialNow={now}
              emptyText="Hand out a task from a chat with + or by typing /task, and it will be listed here."
            />
          </div>
        }
      />
    </div>
  );
}
