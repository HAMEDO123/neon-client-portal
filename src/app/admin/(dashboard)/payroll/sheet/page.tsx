import Link from "next/link";
import { ChevronLeft, Download } from "lucide-react";
import { getAttendanceSheet } from "@/lib/payroll-queries";
import { getTimezone } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { periodLabel, periodOf, previousPeriod } from "@/lib/payroll";
import type { SheetDay, SheetPersonMonth } from "@/lib/attendance-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

// The month, person by person and day by day: the times the device read, how
// long that was, the end each person's own day owed after a late start, and
// what the day fell short by.
//
// The pay sheet says what came off. This says why — a deduction nobody can
// explain is a dispute waiting, and "you were an hour short on the 12th,
// because you came at 12:04 and your day owed until 8" is an answer. It prints
// as it stands, so the same sheet can be handed to somebody on paper.

export default async function PayrollSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: requested } = await searchParams;
  const timezone = await getTimezone();
  const thisMonth = periodOf(todayKey(timezone));
  const period = /^\d{4}-\d{2}$/.test(requested ?? "") ? requested! : thisMonth;

  const sheet = await getAttendanceSheet(period);
  const worked = sheet.people.filter((person) => person.totals.daysRecorded > 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <Link
            href={`/admin/payroll?period=${period}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink/45 hover:text-ink"
          >
            <ChevronLeft size={14} strokeWidth={2} />
            Payroll
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Month sheet</h1>
          <p className="mt-1 text-sm text-ink/50">
            {periodLabel(period)} · every day, the times, and how each deduction was worked out. Print it or open
            the spreadsheet.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <PeriodLink period={previousPeriod(period)} label="Previous month" />
          {period !== thisMonth && <PeriodLink period={thisMonth} label="This month" />}
          <a
            href={`/admin/payroll/timesheet.csv?period=${period}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/25 bg-emerald-50/70 px-4 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
          >
            <Download size={14} strokeWidth={2} />
            Excel (CSV)
          </a>
        </div>
      </div>

      {/* On paper the heading above is gone, so the month says itself. */}
      <h1 className="hidden text-lg font-semibold text-ink print:block">
        Attendance · {periodLabel(period)}
      </h1>

      {worked.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={Wallet}
          title="Nothing recorded this month"
          description="Days appear here as the device reads them."
        />
      ) : (
        <div className="mt-6 flex flex-col gap-8">
          {worked.map((person) => (
            <PersonSheet key={person.person.id} month={person} />
          ))}
        </div>
      )}
    </div>
  );
}

function PersonSheet({ month }: { month: SheetPersonMonth }) {
  const { person, days, totals } = month;

  return (
    <section className="break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-ink">
          {person.name}
          {person.role && <span className="ml-2 text-xs font-normal text-ink/45">{person.role}</span>}
          {person.openHours && (
            <span className="ml-2 rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-medium text-cyan-800">
              Paid by the hour
            </span>
          )}
        </h2>

        <p className="text-xs text-ink/50">
          <span className="font-medium tabular-nums text-ink/70">{totals.hoursWorked} h</span> worked over{" "}
          {totals.daysComplete} {totals.daysComplete === 1 ? "day" : "days"}
          {totals.hoursOff > 0 ? (
            <>
              {" · "}
              <span className="font-medium tabular-nums text-red-600">{totals.hoursOff} h off</span>
              {totals.moneyOff > 0 && <> ({totals.moneyOff.toFixed(2)} JOD)</>}
            </>
          ) : (
            " · nothing off"
          )}
          {totals.daysWithoutClockOut > 0 && (
            <span className="text-amber-700"> · {totals.daysWithoutClockOut} with no clock-out</span>
          )}
        </p>
      </div>

      <div className="mt-2 overflow-x-auto rounded-2xl border border-ink/8">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="bg-ink/[0.03] text-[11px] uppercase tracking-wider text-ink/40">
            <tr>
              <th className="px-3 py-2">Day</th>
              <th className="px-3 py-2">In</th>
              <th className="px-3 py-2">Out</th>
              <th className="px-3 py-2">Worked</th>
              <th className="px-3 py-2">Late</th>
              {/* Hamed's own question: he came at 12, when does he leave? */}
              <th className="px-3 py-2">Owed until</th>
              <th className="px-3 py-2">Off</th>
              <th className="px-3 py-2">How it was worked out</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <DayRow key={day.dayKey} day={day} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DayRow({ day }: { day: SheetDay }) {
  // The studio being shut is a fact; a working day with nothing on it is the
  // platform admitting it does not know what happened. They do not look alike.
  const quiet = day.status === "closed" || day.status === "none";

  return (
    <tr className={cn("border-t border-ink/6", quiet && "text-ink/35")}>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        <span className={quiet ? "" : "font-medium text-ink"}>{Number(day.dayKey.slice(-2))}</span>
        <span className="ml-1.5 text-xs text-ink/40">{day.weekday}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">{day.arrived || <Dash />}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">{day.left || <Dash />}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">
        {day.worked == null ? <Dash /> : `${day.worked} h`}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/60">
        {day.lateHours > 0 ? `${day.lateHours} h` : <Dash />}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink/70">{day.owedUntil || <Dash />}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
        {day.hoursOff > 0 ? (
          <span className="font-medium text-red-600">
            {day.hoursOff} h{day.moneyOff > 0 && <span className="ml-1 text-xs text-ink/40">{day.moneyOff.toFixed(2)}</span>}
          </span>
        ) : (
          <Dash />
        )}
      </td>
      <td className="px-3 py-2 text-xs text-ink/55">
        {day.reason}
        {day.note && <span className="block text-ink/35">{day.note}</span>}
      </td>
    </tr>
  );
}

function Dash() {
  return <span className="text-ink/20">—</span>;
}

function PeriodLink({ period, label }: { period: string; label: string }) {
  return (
    <Link
      href={`/admin/payroll/sheet?period=${period}`}
      className="rounded-full border border-ink/12 bg-white/60 px-4 py-2 text-xs font-medium text-ink/60 hover:text-ink"
    >
      {label}
    </Link>
  );
}
