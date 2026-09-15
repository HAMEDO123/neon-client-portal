import { conversationsFor, requireChatViewer } from "@/lib/chat";
import { taskListFor } from "@/lib/chat-task-store";
import { isOverdue, progressOf } from "@/lib/chat-tasks";
import { getTimezone } from "@/lib/settings";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ConversationList } from "@/components/chat/conversation-list";
import { TaskList } from "@/components/chat/task-list";

// The employee's chats — the team's group, their private conversation with the
// manager, and one with each colleague — and, on the other tab, the tasks the
// manager has given them in any of those chats. `?view=tasks` opens on that tab.

export default async function EmployeeChatsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const viewer = await requireChatViewer("EMPLOYEE");
  if (viewer.type !== "EMPLOYEE") {
    // The admin has their own chat pages; these are the employee's.
    throw new Error("Unauthorized");
  }

  // One after the other, like the other multi-query pages here.
  const conversations = await conversationsFor(viewer);
  const tasks = await taskListFor(viewer);
  const timezone = await getTimezone();
  const { view } = await searchParams;

  const now = new Date().getTime();
  const open = tasks.filter((task) => !progressOf(task.assignments).complete);
  const late = open.filter((task) => isOverdue(task.dueAt, task.assignments, now));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-ink">Chats</h1>

      <ChatSidebar
        className="flex flex-col gap-3"
        initialTab={view === "tasks" ? "tasks" : "chats"}
        openTasks={open.length}
        lateTasks={late.length}
        chats={
          <>
            <div className="glass overflow-hidden rounded-2xl">
              <ConversationList items={conversations} basePath="/employee/chat" timeZone={timezone} />
            </div>
            <p className="mt-4 px-4 text-center text-xs text-ink/40">
              A private chat is seen only by the two people in it. The manager cannot read your chats with colleagues.
            </p>
          </>
        }
        tasks={
          <div className="glass overflow-hidden rounded-2xl">
            <TaskList
              items={tasks}
              basePath="/employee/chat"
              timeZone={timezone}
              initialNow={now}
              emptyText="Tasks the manager gives you in a chat will be listed here."
            />
          </div>
        }
      />
    </div>
  );
}
