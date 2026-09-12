import Link from "next/link";
import { CircleAlert, CirclePause, Clock, TriangleAlert } from "lucide-react";
import {
  describeDay,
  needingAttention,
  overBy,
  overloaded,
  summarise,
  type PersonDay,
} from "@/lib/day-board";
import { cn } from "@/lib/utils";

// The manager's day, as people rather than as tasks.
//
// Ordered by what can be acted on: work stuck on somebody else, then claims
// that do not match the board, then days nobody could finish, then silence.
// Silence is shown as silence — "three unanswered" — and never as a verdict
// about the person.

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-ink/8 bg-white/70 px-3 py-2">
      <p className={cn("text-lg font-semibold tabular-nums", tone ?? "text-ink")}>{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-ink/40">{label}</p>
    </div>
  );
}

export function DayBoardList({ days, dayLabel }: { days: PersonDay[]; dayLabel: string }) {
  const summary = summarise(days);
  const pressing = needingAttention(days);

  return (
    <section className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="On the day" value={summary.planned} />
        <Stat label="No plan yet" value={summary.unplanned} tone={summary.unplanned ? "text-amber-700" : undefined} />
        <Stat label="Blocked" value={summary.blocked} tone={summary.blocked ? "text-pink-strong" : undefined} />
        <Stat
          label="Said started"
          value={summary.contradictions}
          tone={summary.contradictions ? "text-pink-strong" : undefined}
        />
        <Stat label="Overloaded" value={summary.overloaded} tone={summary.overloaded ? "text-amber-700" : undefined} />
        <Stat label="Unanswered" value={summary.unanswered} />
      </div>

      {pressing.length === 0 ? (
        <p className="rounded-xl border border-ink/8 bg-white/70 px-4 py-6 text-center text-sm text-ink/50">
          Nothing on {dayLabel} needs you right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pressing.map((day) => (
            <li key={day.employeeId} className="glass rounded-2xl p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/admin/employees/${day.employeeId}`} className="text-sm font-semibold text-ink hover:underline">
                  {day.name}
                </Link>
                <span className="text-xs text-ink/50">{describeDay(day)}</span>
              </div>

              {overloaded(day) && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-700">
                  <Clock size={13} strokeWidth={2} />
                  {overBy(day)} minutes more than the day holds ({day.plannedMinutes} planned, {day.capacityMinutes}{" "}
                  available)
                </p>
              )}

              {day.blocked.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {day.blocked.map((row, index) => (
                    <li key={index} className="rounded-lg border border-pink/20 bg-pink/[0.05] px-3 py-1.5">
                      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-pink-strong">
                        <CirclePause size={12} strokeWidth={2} />
                        {row.taskName}
                      </p>
                      <p dir="auto" className="mt-0.5 text-xs text-ink/60">
                        {row.reason}
                        {row.who ? ` — ${row.who} can clear it` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {day.contradictions.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {day.contradictions.map((row, index) => (
                    <li
                      key={index}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-ink/12 bg-ink/[0.03] px-3 py-1.5 text-xs text-ink/70"
                    >
                      <TriangleAlert size={12} strokeWidth={2} />
                      {row.taskName}: said started, the board still says pending
                    </li>
                  ))}
                </ul>
              )}

              {day.needsManager.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {day.needsManager.map((row, index) => (
                    <li key={index} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-1.5">
                      <p className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-800">
                        <CircleAlert size={12} strokeWidth={2} />
                        {row.taskName ?? "Their day"} — {row.answer.replace("-", " ")}
                      </p>
                      {row.note && (
                        <p dir="auto" className="mt-0.5 text-xs text-ink/60">
                          {row.note}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-ink/35">
        An unanswered question is a question, not a verdict: nobody here is marked as having done nothing.
      </p>
    </section>
  );
}
