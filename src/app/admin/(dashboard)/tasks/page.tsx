import { FolderKanban } from "lucide-react";
import { getTaskBoard } from "@/lib/queries";
import { getTimezone } from "@/lib/settings";
import { todayKey, tomorrowKey } from "@/lib/time";
import { assignedTasksForWeek } from "@/lib/assigned-tasks";
import { weekDayKeys, weekStartKey } from "@/lib/week";
import { TaskBoard } from "@/components/admin/task-board";
import { WeekView } from "@/components/admin/week-view";
import { EmptyState } from "@/components/ui/empty-state";

// Two tables, because the studio runs on two kinds of work.
//
// The board above is the delivery process: every project against the same
// sections, ticked off as it moves. The week below is everything else — the
// jobs the manager hands out by hand, over the days they run for.

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const timezone = await getTimezone();
  const today = todayKey(timezone);

  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(week ?? "") ? week! : today;

  // Sequential, like the rest of the multi-query pages here.
  const board = await getTaskBoard();
  const assigned = await assignedTasksForWeek(anchor);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Tasks</h1>
      <p className="mt-1 text-sm text-ink/50">
        Every project against the same delivery process. Tick what you finished today, flag what you are picking up
        tomorrow.
      </p>

      {board.rows.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={FolderKanban}
          title="No active projects yet"
          description="Every project becomes a row on this board — create one to get started."
        />
      ) : (
        <div className="mt-6">
          <TaskBoard board={board} todayKey={today} tomorrowKey={tomorrowKey(timezone)} />
        </div>
      )}

      <div className="mt-12">
        <WeekView
          team={board.team}
          tasks={assigned}
          weekKeys={weekDayKeys(anchor)}
          todayKey={today}
          weekStart={weekStartKey(anchor)}
        />
      </div>
    </div>
  );
}
