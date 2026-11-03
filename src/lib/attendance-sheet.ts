import { formatTimeIn, wallClockIn } from "@/lib/time";
import { hoursOn, isWorkingDay, weekdayOf, type WorkHours } from "@/lib/work-hours";
import { clockLabel, endOfDayMinutes, hoursShort, lateHours, minutesInDay, workedHours } from "@/lib/attendance";
import { awayMinutesOf, storedBreaks } from "@/lib/attendance-breaks";
import { monthDayKeys } from "@/lib/attendance-month";
import { round } from "@/lib/payroll";

// One person's month, a day at a time: when they came, when they left, how
// long that was, the end their own day owed after a late start, and what the
// shortfall cost.
//
// The month grid answers "which days cost something". This answers "why" —
// every figure payroll multiplied, written out beside the times it came from,
// so a deduction can be checked by somebody who was not there rather than
// taken on trust. It is the shape a payslip argument actually takes.
//
// Pure, like the rest of attendance: it reads rows and the studio's hours and
// returns text and numbers. Nothing here touches a database, a file or a
// response, which is why both the screen and the download can read it and
// cannot disagree about a single figure.

/** One recorded day, as the database holds it. */
export type SheetRecord = {
  employeeId: string;
  dayKey: string;
  arrivedAt: Date | null;
  departedAt: Date | null;
  /** The stored step-outs — `storedBreaks` reads the jsonb shape. */
  breaks: unknown;
  delayHours: number;
  earlyHours: number;
  awayHours: number;
  /** What the day cost: the one figure payroll multiplies. */
  shortHours: number;
  source: string;
  note: string | null;
};

export type SheetPerson = {
  id: string;
  name: string;
  role: string | null;
  /** Paid for the hours worked rather than for the day (`Employee.openHours`). */
  openHours: boolean;
  /** Money per hour, for what a day's shortfall costs. Zero when no salary is set. */
  hourlyRate: number;
};

/**
 * What became of one day.
 *
 * `none` and `closed` are kept apart on purpose: the studio being shut is a
 * fact, and a working day with nothing on it is the platform admitting it does
 * not know — it cannot tell "did not come" from "the device did not read them".
 */
export type SheetStatus = "worked" | "typed" | "none" | "closed";

export type SheetDay = {
  dayKey: string;
  /** "Tue", for somebody reading down the column. */
  weekday: string;
  status: SheetStatus;
  arrived: string;
  steppedOut: string;
  steppedBack: string;
  left: string;
  /** Time at work, capped at the studio's day. Null when it cannot be known. */
  worked: number | null;
  /** Time at work before the cap, when somebody stayed past the eighth hour. */
  onSite: number | null;
  lateHours: number;
  /** The end this person's own day owed, lateness and step-outs included. */
  owedUntil: string;
  hoursOff: number;
  moneyOff: number;
  /** The whole day in a sentence: the times, the end owed, and what it cost. */
  reason: string;
  source: string;
  note: string;
};

export type SheetTotals = {
  daysRecorded: number;
  /** Days with both times — the only days hours can be totalled from. */
  daysComplete: number;
  daysWithoutClockOut: number;
  hoursWorked: number;
  hoursOnSite: number;
  hoursOff: number;
  moneyOff: number;
};

export type SheetPersonMonth = { person: SheetPerson; days: SheetDay[]; totals: SheetTotals };

export type AttendanceSheet = { monthKey: string; people: SheetPersonMonth[] };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Hours, to two places, for a figure somebody reads rather than one that is paid. */
function hours2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The month written out, one section per person.
 *
 * Every day of the month up to today gets a line, recorded or not — a sheet
 * that lists only the days with rows cannot be checked against a calendar, and
 * the days missing from it are exactly the ones worth asking about. Days still
 * to come are left off: nothing can have happened on them yet.
 */
export function buildAttendanceSheet(input: {
  monthKey: string;
  hours: WorkHours;
  timeZone: string;
  todayKey: string;
  people: SheetPerson[];
  records: SheetRecord[];
}): AttendanceSheet {
  const { monthKey, hours, timeZone, todayKey, people, records } = input;

  const dayKeys = monthDayKeys(monthKey).filter((dayKey) => dayKey <= todayKey);

  const found = new Map<string, SheetRecord>();
  for (const record of records) found.set(`${record.employeeId}|${record.dayKey}`, record);

  return {
    monthKey,
    people: people.map((person) => {
      const days = dayKeys.map((dayKey) =>
        describeDay({ person, hours, timeZone, dayKey, record: found.get(`${person.id}|${dayKey}`) ?? null })
      );

      const recorded = days.filter((day) => day.status === "worked" || day.status === "typed");
      const complete = days.filter((day) => day.worked != null);

      return {
        person,
        days,
        totals: {
          daysRecorded: recorded.length,
          daysComplete: complete.length,
          daysWithoutClockOut: days.filter((day) => day.status === "worked" && day.worked == null).length,
          // Added up from the figures on screen rather than recomputed, so the
          // total is the sum of the column above it and nothing else.
          hoursWorked: hours2(complete.reduce((total, day) => total + (day.worked ?? 0), 0)),
          hoursOnSite: hours2(complete.reduce((total, day) => total + (day.onSite ?? 0), 0)),
          hoursOff: hours2(recorded.reduce((total, day) => total + day.hoursOff, 0)),
          moneyOff: round(recorded.reduce((total, day) => total + day.moneyOff, 0)),
        },
      };
    }),
  };
}

function describeDay(input: {
  person: SheetPerson;
  hours: WorkHours;
  timeZone: string;
  dayKey: string;
  record: SheetRecord | null;
}): SheetDay {
  const { person, hours, timeZone, dayKey, record } = input;

  const base = {
    dayKey,
    weekday: WEEKDAYS[weekdayOf(dayKey)],
    arrived: "",
    steppedOut: "",
    steppedBack: "",
    left: "",
    worked: null,
    onSite: null,
    lateHours: 0,
    owedUntil: "",
    hoursOff: 0,
    moneyOff: 0,
    source: "",
    note: "",
  };

  if (!record) {
    return isWorkingDay(hours, dayKey)
      ? { ...base, status: "none", reason: "Nothing recorded for this day." }
      : { ...base, status: "closed", reason: "Studio closed." };
  }

  const steps = storedBreaks(record.breaks);
  const common = {
    ...base,
    steppedOut: steps.map((step) => step.out).join(", "),
    steppedBack: steps.map((step) => step.back).join(", "),
    hoursOff: hours2(record.shortHours),
    moneyOff: round(person.hourlyRate * Math.max(0, record.shortHours)),
    source: record.source,
    note: record.note ?? "",
  };

  // A day with no arrival is a figure somebody typed: there are no times to
  // measure it against, and what the manager wrote is the whole record of it.
  if (!record.arrivedAt) {
    return {
      ...common,
      // Nothing to measure, so the stored figure is the only lateness there is.
      lateHours: hours2(record.delayHours),
      status: "typed",
      reason:
        record.shortHours > 0
          ? `No times recorded — ${hours2(record.shortHours)} h off as entered by hand.`
          : "No times recorded, nothing off.",
    };
  }

  const arrival = wallClockIn(timeZone, record.arrivedAt);
  const owedMinutes = endOfDayMinutes(hours, dayKey, arrival, awayMinutesOf(steps));

  // Somebody paid by the hour has no end to owe and cannot be late: they are
  // paid for the hours they work, so the studio's own day is not a thing their
  // day is measured against. Printing an end and a lateness for them would be
  // inventing a rule they are not held to — and `applyAttendance` zeroes both
  // on their rows for exactly that reason.
  const owedUntil = person.openHours ? "" : clockLabel(owedMinutes);

  // Lateness read off the arrival rather than taken from the column, because
  // this sheet's whole job is to show the working: `delayHours` is a figure
  // written when the row was last touched, and a row whose column says "0 h
  // late" beside an arrival of 1:04 PM would make the sentence nonsense. The
  // same function payroll is measured by, on that day's own hours.
  const late = person.openHours ? 0 : lateHours(hoursOn(hours, dayKey), arrival);
  // Empty rather than null for a clock-out that never came: these are cells on
  // a sheet, and "—" is the screen's business, not this builder's.
  const arrived = formatTimeIn(timeZone, record.arrivedAt) ?? "";
  const left = formatTimeIn(timeZone, record.departedAt) ?? "";

  // The same arithmetic the pay sheet totals, one day at a time, so a day's
  // figure and the month's cannot come from two different rules.
  const day = workedHours(
    [{ arrivedAt: record.arrivedAt, departedAt: record.departedAt, awayHours: record.awayHours }],
    hours
  );
  const worked = record.departedAt ? day.hours : null;
  const onSite = record.departedAt ? day.onSite : null;

  // What today's rule makes of these times, against what was actually charged.
  // They agree on every ordinary day; where they do not — a row written before
  // a rule changed, or hours edited since — the sentence says both rather than
  // explaining a deduction that is not the one on the payslip.
  const departure = record.departedAt ? minutesInDay(wallClockIn(timeZone, record.departedAt), arrival) : null;
  // Nothing to compare for an hourly day: there is no end it fell short of.
  const recomputed = person.openHours ? record.shortHours : hoursShort(owedMinutes, departure);

  return {
    ...common,
    status: "worked",
    arrived,
    left,
    owedUntil,
    worked,
    onSite,
    lateHours: hours2(late),
    reason: explain({
      person,
      record,
      arrived,
      left,
      owedUntil,
      worked,
      onSite,
      late,
      recomputed,
      steps: steps.length,
    }),
  };
}

/** The day in a sentence, in the terms the studio argues about it in. */
function explain(input: {
  person: SheetPerson;
  record: SheetRecord;
  arrived: string;
  left: string;
  owedUntil: string;
  worked: number | null;
  onSite: number | null;
  /** Lateness as the times say it, not as the column holds it. */
  late: number;
  /** What these times cost under today's rule, for comparing with what was charged. */
  recomputed: number;
  steps: number;
}): string {
  const { person, record, arrived, left, owedUntil, worked, onSite, late, recomputed, steps } = input;

  const stepped = steps > 0 ? ` Out and back ${steps === 1 ? "once" : `${steps} times`}, ${hours2(record.awayHours)} h.` : "";
  // Only ever on a day where the two disagree, and then it is the important
  // half of the sentence: the payslip followed the figure on the row.
  const charged =
    hours2(recomputed) === hours2(record.shortHours)
      ? ""
      : ` Charged as ${hours2(record.shortHours)} h off, not ${hours2(recomputed)} h.`;

  // Paid for the hours, so there is no end to owe: the day is what was worked,
  // up to the studio's eight and no further.
  if (person.openHours) {
    if (worked == null) return `In ${arrived}. No clock-out recorded, so the day counts nothing.${stepped}${charged}`;
    const capped = onSite != null && onSite > worked ? ` (here ${hours2(onSite)} h — there is no overtime)` : "";
    return `Paid by the hour: in ${arrived}, out ${left}, ${worked} h${capped}.${stepped}${charged}`;
  }

  const owed =
    late > 0 ? `${hours2(late)} h late, so the day owed until ${owedUntil}` : `the day owed until ${owedUntil}`;

  if (worked == null) {
    return `In ${arrived}, ${owed}. No clock-out recorded, so nothing is charged.${stepped}${charged}`;
  }

  const outcome =
    recomputed > 0 ? `left ${left}, ${hours2(recomputed)} h short` : `left ${left} — the day was worked, nothing off`;

  return `In ${arrived}, ${owed}; ${outcome}.${stepped}${charged}`;
}

const COLUMNS = [
  "Employee",
  "Role",
  "Date",
  "Day",
  "Status",
  "In",
  "Step out",
  "Step back",
  "Out",
  "Worked (h)",
  "Late (h)",
  "Owed until",
  "Hours off",
  "Money off (JOD)",
  "How it was worked out",
  "Source",
  "Note",
];

const TOTAL_COLUMNS = [
  "Employee",
  "Days recorded",
  "Days with both times",
  "Days without clock-out",
  "Hours worked",
  "Hours here",
  "Hours off",
  "Money off (JOD)",
];

const STATUS: Record<SheetStatus, string> = {
  worked: "Worked",
  typed: "Typed by hand",
  none: "No record",
  closed: "Closed",
};

/**
 * The sheet as a spreadsheet: one row per person per day, then the totals.
 *
 * CSV rather than a real workbook because every spreadsheet opens one and it
 * needs no library — but written for Excel specifically: a byte-order mark so
 * it reads the file as UTF-8 instead of guessing a codepage, and CRLF line
 * endings.
 */
export function attendanceSheetCsv(sheet: AttendanceSheet): string {
  const lines: string[] = [row(COLUMNS)];

  for (const person of sheet.people) {
    for (const day of person.days) {
      lines.push(
        row([
          person.person.name,
          person.person.role ?? "",
          day.dayKey,
          day.weekday,
          STATUS[day.status],
          day.arrived,
          day.steppedOut,
          day.steppedBack,
          day.left,
          day.worked == null ? "" : day.worked,
          day.lateHours === 0 ? "" : day.lateHours,
          day.owedUntil,
          day.hoursOff === 0 ? "" : day.hoursOff,
          day.moneyOff === 0 ? "" : day.moneyOff,
          day.reason,
          day.source,
          day.note,
        ])
      );
    }
  }

  lines.push("", row(TOTAL_COLUMNS));
  for (const { person, totals } of sheet.people) {
    lines.push(
      row([
        person.name,
        totals.daysRecorded,
        totals.daysComplete,
        totals.daysWithoutClockOut,
        totals.hoursWorked,
        totals.hoursOnSite,
        totals.hoursOff,
        totals.moneyOff,
      ])
    );
  }

  // The mark goes on the front of the file, not of a line.
  return `﻿${lines.join("\r\n")}\r\n`;
}

function row(cells: (string | number)[]): string {
  return cells.map(cell).join(",");
}

/**
 * One cell, quoted when it has to be.
 *
 * A leading `=`, `+` or `@` is defused with an apostrophe, which Excel eats
 * when it opens the file: notes are typed by people, and a spreadsheet that
 * runs what it was handed is a spreadsheet that can be made to do anything by
 * anybody who can write a note.
 */
function cell(value: string | number): string {
  if (typeof value === "number") return String(value);

  const text = /^[=+@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.split('"').join('""')}"` : text;
}
