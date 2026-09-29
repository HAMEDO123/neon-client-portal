import { prisma } from "@/lib/db";
import { holderKey, ownerOf } from "@/lib/ownership";
import { getTimezone } from "@/lib/settings";
import { dateToDayKey, dayKeyToDate, instantAt, shiftDayKey, todayKey } from "@/lib/time";

// The Home tab's "Today's Tasks", for the phone only: what is really on the
// studio's calendar today, in the studio's timezone —
//
// - board cells scheduled for today, or due at a moment today;
// - jobs handed out by hand whose span of days includes today;
// - meetings set in a chat that start today.
//
// Nothing is invented to fill the list: a quiet day is an empty one, and the
// app says so. A cell's person is resolved through `ownerOf` — the one rule
// the board, the portal and analytics share — never re-derived here. States
// travel as the board's own words; the app only ever shows them.

type Person = { id: string; name: string; color: string };

export async function homeToday() {
  const timezone = await getTimezone();
  const today = todayKey(timezone);
  const now = new Date();
  const start = instantAt(today, "00:00", timezone) ?? now;
  const end = instantAt(shiftDayKey(today, 1), "00:00", timezone) ?? now;
  const day = dayKeyToDate(today);
  const isToday = (at: Date | null | undefined) => !!at && at >= start && at < end;

  // The board leaves archived projects out; so does this.
  const cells = await prisma.projectTaskEntry.findMany({
    where: {
      project: { publishState: { not: "ARCHIVED" } },
      OR: [{ scheduledFor: day }, { dueAt: { gte: start, lt: end } }],
    },
    select: {
      id: true,
      state: true,
      priority: true,
      dueAt: true,
      scheduledFor: true,
      assigneeId: true,
      projectId: true,
      project: { select: { name: true, coverImageUrl: true } },
      task: { select: { name: true, employeeId: true, sectionId: true } },
    },
  });

  const held = await prisma.projectSectionAssignment.findMany({
    where: { employeeId: { not: null } },
    select: { projectId: true, sectionId: true, employeeId: true },
  });
  const holderOf = new Map(held.map((row) => [holderKey(row.projectId, row.sectionId), row.employeeId]));

  // Jobs of people still on the team: a disabled account's jobs are not
  // anybody's day any more (the day board reads active people only, too).
  const jobs = await prisma.assignedTask.findMany({
    where: { startDay: { lte: day }, endDay: { gte: day }, employee: { active: true } },
    select: {
      id: true,
      title: true,
      state: true,
      priority: true,
      endDay: true,
      employeeId: true,
      chatTask: { select: { dueAt: true } },
    },
  });

  const meetings = await prisma.chatMeeting.findMany({
    where: { startsAt: { gte: start, lt: end } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      title: true,
      startsAt: true,
      durationMinutes: true,
      mode: true,
      place: true,
      _count: { select: { attendees: true } },
    },
  });

  const cellOwners = new Map(
    cells.map((cell) => [
      cell.id,
      ownerOf(
        cell.assigneeId,
        cell.task,
        cell.task.sectionId ? holderOf.get(holderKey(cell.projectId, cell.task.sectionId)) : undefined
      ),
    ])
  );
  const ids = new Set<string>([
    ...[...cellOwners.values()].filter((id): id is string => !!id),
    ...jobs.map((job) => job.employeeId),
  ]);
  const people = new Map<string, Person>(
    (
      await prisma.employee.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, name: true, color: true },
      })
    ).map((row) => [row.id, row])
  );

  const items = [
    ...cells.map((cell) => {
      const owner = cellOwners.get(cell.id);
      return {
        kind: "cell" as const,
        id: cell.id,
        title: cell.task.name,
        projectId: cell.projectId,
        projectName: cell.project.name as string | null,
        coverImageUrl: cell.project.coverImageUrl,
        person: (owner ? people.get(owner) : undefined) ?? null,
        state: cell.state as string | null,
        priority: cell.priority as string | null,
        // A time only when the moment it is due is today.
        at: isToday(cell.dueAt) ? cell.dueAt : null,
        scheduled: dateToDayKey(cell.scheduledFor) === today,
        until: null as string | null,
        durationMinutes: null as number | null,
        mode: null as string | null,
        place: null as string | null,
        attendees: null as number | null,
      };
    }),
    ...jobs.map((job) => {
      const until = dateToDayKey(job.endDay);
      return {
        kind: "job" as const,
        id: job.id,
        title: job.title,
        projectId: null as string | null,
        projectName: null as string | null,
        coverImageUrl: null as string | null,
        person: people.get(job.employeeId) ?? null,
        state: job.state as string | null,
        priority: job.priority as string | null,
        // A job from a chat card carries the exact moment it is due.
        at: isToday(job.chatTask?.dueAt) ? job.chatTask!.dueAt : null,
        scheduled: true,
        // The last day of a job that runs past today.
        until: until && until > today ? until : null,
        durationMinutes: null as number | null,
        mode: null as string | null,
        place: null as string | null,
        attendees: null as number | null,
      };
    }),
    ...meetings.map((meeting) => ({
      kind: "meeting" as const,
      id: meeting.id,
      title: meeting.title,
      projectId: null as string | null,
      projectName: null as string | null,
      coverImageUrl: null as string | null,
      person: null as Person | null,
      state: null as string | null,
      priority: null as string | null,
      at: meeting.startsAt as Date | null,
      scheduled: true,
      until: null as string | null,
      durationMinutes: meeting.durationMinutes as number | null,
      mode: meeting.mode as string | null,
      place: meeting.place,
      attendees: meeting._count.attendees as number | null,
    })),
  ];

  // Timed things in the order they happen, then the rest of the day's work.
  const kindOrder = { meeting: 0, cell: 1, job: 2 } as const;
  items.sort((a, b) => {
    if (a.at && b.at) return a.at.getTime() - b.at.getTime();
    if (a.at || b.at) return a.at ? -1 : 1;
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    return a.title.localeCompare(b.title);
  });

  return { timezone, dayKey: today, items };
}
