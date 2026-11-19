import { isWorkingDay, weekdayOf, type WorkHours } from "@/lib/work-hours";

// Somebody's own pay period at a glance, for their profile (design 2,
// 2026-11-19): every day of the period as a square, and two numbers.
//
// Pure, for the same reason the manager's month grid is (attendance-month.ts):
// a period runs from the 5th to the 4th and crosses a month, and a day in the
// wrong square is the kind of mistake nobody notices.
//
// **A working day with no record is "nothing recorded", never "absent".** The
// platform cannot tell somebody who did not come from a device that did not
// read them, and the person looking at this is the last one who should be told
// they were missing on a day they were there.

export type MyMonthState = "on-time" | "late" | "none" | "off" | "future";

export type MyMonthDay = {
  dayKey: string;
  dayOfMonth: number;
  /** 0 is Sunday. */
  weekday: number;
  state: MyMonthState;
  isToday: boolean;
};

export type MyMonth = {
  days: MyMonthDay[];
  /** Working days from the start of the period to today, today included. */
  workingSoFar: number;
  /** Days with an attendance record. */
  recorded: number;
  /** Recorded days that started on time. */
  onTime: number;
  /** onTime / recorded as a whole percent; null before anything is recorded. */
  percentOnTime: number | null;
};

export function myMonth(
  dayKeys: string[],
  todayKey: string,
  hours: WorkHours,
  records: { dayKey: string; delayHours: number }[]
): MyMonth {
  const byDay = new Map(records.map((record) => [record.dayKey, record]));

  const days = dayKeys.map((dayKey): MyMonthDay => {
    const record = byDay.get(dayKey);
    const future = dayKey > todayKey;
    // A record on a day off still counts: somebody came in.
    const state: MyMonthState = record
      ? record.delayHours > 0
        ? "late"
        : "on-time"
      : future
        ? "future"
        : isWorkingDay(hours, dayKey)
          ? "none"
          : "off";
    return { dayKey, dayOfMonth: Number(dayKey.slice(8, 10)), weekday: weekdayOf(dayKey), state, isToday: dayKey === todayKey };
  });

  const workingSoFar = dayKeys.filter((dayKey) => dayKey <= todayKey && isWorkingDay(hours, dayKey)).length;
  const inPeriod = records.filter((record) => dayKeys.includes(record.dayKey) && record.dayKey <= todayKey);
  const recorded = inPeriod.length;
  const onTime = inPeriod.filter((record) => record.delayHours <= 0).length;

  return {
    days,
    workingSoFar,
    recorded,
    onTime,
    percentOnTime: recorded === 0 ? null : Math.round((onTime / recorded) * 100),
  };
}
