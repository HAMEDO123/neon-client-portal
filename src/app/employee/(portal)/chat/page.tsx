import { conversationsFor, requireChatViewer } from "@/lib/chat";
import { taskListFor } from "@/lib/chat-task-store";
import { isOverdue, progressOf } from "@/lib/chat-tasks";
import { getTimezone } from "@/lib/settings";
import { getSessionEmployee } from "@/lib/employee-session";
import { inboxSummary } from "@/lib/notifications/whatsapp-events";
import { inboxUrl, whatsAppChatBase } from "@/lib/whatsapp-watch";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ConversationList } from "@/components/chat/conversation-list";
import { TaskList } from "@/components/chat/task-list";
import { TeamStrip } from "@/components/chat/team-strip";
import { OpenOnDesk } from "@/components/chat/open-on-desk";
import { NeonLoader } from "@/components/ui/neon-loader";

// The employee's chats — the team's group, their private conversation with the
// manager, one with each colleague, and the clients writing to the company's
// WhatsApp, a row each — and, on the other tab, the tasks the manager has
// given them in any of the team's chats. `?view=tasks` opens on that tab.

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

  // The company number's clients, a row each among the team's chats — for
  // whoever may open them. Somebody the manager has switched it off for is not
  // shown rows that would turn them away.
  const me = await getSessionEmployee();
  const summary = me?.canReadWhatsApp ? await inboxSummary() : null;
  const whatsapp = summary
    ? { basePath: whatsAppChatBase("employee"), rows: summary.rows, allHref: inboxUrl("employee") }
    : null;

  const now = new Date().getTime();
  const open = tasks.filter((task) => !progressOf(task.assignments).complete);
  const late = open.filter((task) => isOverdue(task.dueAt, task.assignments, now));

  // On a desk this page opens the newest conversation in the three-panel
  // view (open-on-desk.tsx) — unless it was asked for the Tasks tab, which
  // only this page shows.
  const deskHref = view !== "tasks" && conversations[0] ? `/employee/chat/${conversations[0].slug}` : null;

  return (
    <div className="flex flex-col gap-4">
      {deskHref && (
        <>
          <OpenOnDesk href={deskHref} />
          <div className="hidden min-h-[50vh] items-center justify-center lg:flex">
            <NeonLoader size="small" />
          </div>
        </>
      )}
      <div className={deskHref ? "flex flex-col gap-4 lg:hidden" : "contents"}>
      <h1 className="text-xl font-semibold text-ink">Chat</h1>

      {/* Everybody you talk to, as faces (design 2). */}
      <TeamStrip conversations={conversations} basePath="/employee/chat" />

      <ChatSidebar
        className="flex flex-col gap-3"
        initialTab={view === "tasks" ? "tasks" : "chats"}
        openTasks={open.length}
        lateTasks={late.length}
        chats={
          <>
            <div className="glass overflow-hidden rounded-2xl">
              <ConversationList
                items={conversations}
                basePath="/employee/chat"
                timeZone={timezone}
                whatsapp={whatsapp}
              />
            </div>
            <p className="mt-4 px-4 text-center text-xs text-ink/40">
              A private chat is seen only by the two people in it. The manager cannot read your chats with colleagues.
              {whatsapp &&
                " The rows with the green mark are clients on the company’s WhatsApp: everybody on the team sees those, and an answer goes out as the studio."}
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
    </div>
  );
}
