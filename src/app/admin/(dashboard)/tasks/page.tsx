import { FolderKanban } from "lucide-react";
import { getTaskBoard } from "@/lib/queries";
import { getTimezone } from "@/lib/settings";
import { todayKey, tomorrowKey } from "@/lib/time";
import { TaskBoard } from "@/components/admin/task-board";
import { EmptyState } from "@/components/ui/empty-state";

export default async function TasksPage() {
  const board = await getTaskBoard();
  const timezone = await getTimezone();

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
          <TaskBoard board={board} todayKey={todayKey(timezone)} tomorrowKey={tomorrowKey(timezone)} />
        </div>
      )}
    </div>
  );
}
