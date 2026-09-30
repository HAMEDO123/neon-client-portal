import { getEmployees, getProcessSections, getProcessTasks, getStagePeriods } from "@/lib/queries";
import { periodTimeline, totalDays } from "@/lib/stage-schedule";
import { linesOf, mayAutoAccept } from "@/lib/task-types";

// The delivery process, for the phone: the parts of /admin/settings that
// define it — the sections, the steps in them and who usually does each, what
// each kind of work needs, and the stage periods.
//
// The same queries the settings page reads, in the same order. What the page
// works out for display is worked out here too, from the same pure functions,
// so the phone says exactly what the website says: where each range sits on
// the timeline (`periodTimeline`), how long the timed part is (`totalDays`),
// how many lines a standard really has (`linesOf`) and whether a step would
// actually be accepted without a person (`mayAutoAccept`).

export async function mobileProcess() {
  const stages = await getProcessTasks();
  const sections = await getProcessSections();
  const periods = await getStagePeriods();
  const team = await getEmployees();

  const periodRows = periods.map((period) => ({
    id: period.id,
    fromTaskId: period.fromTaskId,
    toTaskId: period.toTaskId,
    days: period.days,
  }));

  const timeline = periodTimeline(
    stages.map((stage) => stage.id),
    periodRows
  ).map(({ period, startDay, endDay, steps }) => ({
    // The row a range came from, so the phone can remove or change that one.
    periodId:
      periodRows.find((row) => row.fromTaskId === period.fromTaskId && row.toTaskId === period.toTaskId)?.id ?? null,
    fromTaskId: period.fromTaskId,
    toTaskId: period.toTaskId,
    days: period.days,
    startDay,
    endDay,
    steps,
  }));

  return {
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      color: section.color,
      order: section.order,
    })),
    steps: stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      order: stage.order,
      sectionId: stage.sectionId,
      ownerId: stage.employeeId,
      deliverable: stage.deliverable,
      acceptance: stage.acceptance,
      estimateHours: stage.estimateHours,
      evidence: stage.evidence,
      checklist: stage.checklist,
      autoAccept: stage.autoAccept,
      reviewerId: stage.reviewerId,
      acceptanceLines: linesOf(stage.acceptance),
      checklistLines: linesOf(stage.checklist).length,
      mayAutoAccept: mayAutoAccept(stage),
    })),
    periods: periodRows,
    timeline,
    totalDays: totalDays(periodRows),
    // Everybody on the staff side: the reviewer list is all of them, as on the
    // page; who usually does a step is chosen from the active ones, as on the
    // board.
    team: team.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
      color: person.color,
      active: person.active,
      photoUrl: person.photoUrl,
    })),
  };
}
