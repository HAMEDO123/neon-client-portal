"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { WeekBoard } from "@/components/admin/week-board";
import type { AssignedTaskView } from "@/lib/assigned-tasks";

// Which week is showing lives in the URL, so a link to a particular week is a
// link, the back button works, and a refresh does not jump to today.
//
// `basePath` because the same board is now open in two places: the manager's
// `/admin/tasks` and, for whoever may hand work out, the employee portal's own
// Tasks tab. Hard-coding the admin path sent somebody on the employee side to
// a page they cannot open, on every arrow press.
export function WeekView({
  team,
  tasks,
  weekKeys,
  todayKey,
  weekStart,
  basePath = "/admin/tasks",
}: {
  team: { id: string; name: string; color: string; role: string | null }[];
  tasks: AssignedTaskView[];
  weekKeys: string[];
  todayKey: string;
  weekStart: string;
  basePath?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <WeekBoard
      team={team}
      tasks={tasks}
      weekKeys={weekKeys}
      todayKey={todayKey}
      onWeek={(next) => {
        const query = new URLSearchParams(params.toString());
        if (next === weekStart) return;
        query.set("week", next);
        // scroll:false — the week table is halfway down the page and jumping
        // to the top on every arrow press makes it unusable.
        router.push(`${basePath}?${query.toString()}`, { scroll: false });
      }}
    />
  );
}
