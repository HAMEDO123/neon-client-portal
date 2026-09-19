import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MANUAL } from "@/lib/attendance";
import { monthLabel, shiftMonth, type Month, type MonthEntry } from "@/lib/attendance-month";

// The month, as a sheet: people down the side, every day across the top.
//
// It replaced a list of the last fifteen rows, which could answer "what came in
// recently" and never "was anybody in on the 3rd" — the question a month is
// actually looked at for.
//
// Plain links rather than a client component: moving between months is a
// different page of the same screen, so it costs no JavaScript, works before
// hydration, and can be linked to and reloaded.

export function AttendanceMonth({ month, thisMonth }: { month: Month; thisMonth: string }) {
  const previous = shiftMonth(month.monthKey, -1);
  const next = shiftMonth(month.monthKey, 1);
  // Nothing can be recorded in a month that has not happened, so there is
  // nowhere forward to go from the current one.
  const canGoForward = month.monthKey < thisMonth;

  const recorded = month.rows.reduce((total, row) => total + row.daysRecorded, 0);

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-bark/40">The month</h2>
          <p className="mt-1 font-display text-lg font-semibold text-bark">{monthLabel(month.monthKey)}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <Step to={`?month=${previous}`} label={`Go to ${monthLabel(previous)}`}>
            <ChevronLeft size={16} strokeWidth={2} />
          </Step>
          {month.monthKey !== thisMonth && (
            <Link
              href={`?month=${thisMonth}`}
              className="rounded-full border border-warm-line px-3 py-1.5 text-xs font-medium text-bark transition-colors hover:bg-clay-soft"
            >
              This month
            </Link>
          )}
          {canGoForward ? (
            <Step to={`?month=${next}`} label={`Go to ${monthLabel(next)}`}>
              <ChevronRight size={16} strokeWidth={2} />
            </Step>
          ) : (
            <span
              aria-hidden
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-warm-line text-bark/20"
            >
              <ChevronRight size={16} strokeWidth={2} />
            </span>
          )}
        </div>
      </div>

      {month.rows.length === 0 ? (
        <p className="mt-3 text-sm text-bark/50">Nobody to show yet.</p>
      ) : (
        <>
          {/* Tables are the one thing allowed to be wider than the page, in
              their own scroller, so the page itself never scrolls sideways. */}
          <div className="mt-3 overflow-x-auto rounded-2xl border border-warm-line bg-card">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-clay-soft/40 text-[11px] uppercase tracking-wider text-bark/45">
                  <th scope="col" className="sticky left-0 z-10 bg-[#f4efe9] px-4 py-2.5 text-left font-medium">
                    Who
                  </th>
                  {month.days.map((day) => (
                    <th
                      key={day.dayKey}
                      scope="col"
                      className={cell(
                        "px-0 py-2.5 text-center font-medium tabular-nums",
                        !day.worked && "bg-bark/[0.045] text-bark/25",
                        day.isToday && "bg-clay/15 text-clay"
                      )}
                    >
                      <span className="block">{day.dayOfMonth}</span>
                      <span className="block text-[9px] font-normal text-bark/30">{WEEKDAYS[day.weekday]}</span>
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Days
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">
                    Late
                  </th>
                </tr>
              </thead>

              <tbody>
                {month.rows.map((row) => (
                  <tr key={row.employeeId} className="border-t border-warm-line">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 whitespace-nowrap bg-card px-4 py-2.5 text-left text-sm font-medium text-bark"
                    >
                      {row.name}
                      {!row.active && <span className="ml-1.5 text-xs font-normal text-bark/35">left</span>}
                    </th>

                    {row.cells.map((entry, index) => {
                      const day = month.days[index];
                      return (
                        <td
                          key={day.dayKey}
                          title={describe(row.name, day.dayKey, entry)}
                          className={cell(
                            "px-0 py-2.5 text-center tabular-nums",
                            !day.worked && "bg-bark/[0.045]",
                            day.isToday && "bg-clay/10"
                          )}
                        >
                          <Mark entry={entry} future={day.isFuture} worked={day.worked} />
                        </td>
                      );
                    })}

                    <td className="px-3 py-2.5 text-right tabular-nums text-bark/60">{row.daysRecorded}</td>
                    <td
                      className={cell(
                        "px-3 py-2.5 text-right tabular-nums",
                        row.hoursLate > 0 ? "font-medium text-amber-700" : "text-bark/35"
                      )}
                    >
                      {row.hoursLate > 0 ? `${row.hoursLate}h` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-bark/45">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-600" /> on time
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="font-medium tabular-nums text-amber-700">1.5</span> hours late
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-clay ring-2 ring-clay/25" /> typed by you
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-[3px] bg-bark/[0.09]" /> not a working day
            </span>
          </p>

          {/* Said outright, because a grid of blanks is exactly the shape that
              invites the other reading. */}
          <p className="mt-1.5 text-[11px] text-bark/35">
            An empty day means nothing was recorded — not that somebody was away. A day the device did not read,
            or one nobody has synced, looks exactly the same here. {recorded} {recorded === 1 ? "day is" : "days are"}{" "}
            recorded this month.
          </p>
        </>
      )}
    </section>
  );
}

// Sunday first, the way the week runs here and the way the week board counts.
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** One step through the months. A link, so it works before any JavaScript does. */
function Step({ to, label, children }: { to: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-warm-line text-bark transition-colors hover:bg-clay-soft"
    >
      {children}
    </Link>
  );
}

function cell(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** What one day says, at a glance: on time, how late, or nothing at all. */
function Mark({ entry, future, worked }: { entry: MonthEntry | null; future: boolean; worked: boolean }) {
  if (!entry) {
    // Nothing to say, and three different reasons for it — so it says nothing.
    return <span className="text-bark/15">{future || !worked ? "" : "·"}</span>;
  }

  const typed = entry.source === MANUAL;

  if (entry.delayHours > 0) {
    return (
      <span
        className={cell(
          "inline-block min-w-[1.75rem] rounded px-1 text-xs font-medium text-amber-700",
          typed && "ring-1 ring-clay/40"
        )}
      >
        {entry.delayHours}
      </span>
    );
  }

  return (
    <span
      aria-label="on time"
      className={cell(
        "inline-block h-2 w-2 rounded-full",
        typed ? "bg-clay ring-2 ring-clay/25" : "bg-emerald-600"
      )}
    />
  );
}

/** The whole of a day, for the tooltip — the arrival time included. */
function describe(name: string, dayKey: string, entry: MonthEntry | null) {
  if (!entry) return `${name} · ${dayKey} · nothing recorded`;

  const how = entry.source === MANUAL ? "typed by the manager" : "from the device";
  const late = entry.delayHours > 0 ? `${entry.delayHours}h late` : "on time";
  return `${name} · ${dayKey} · ${late} · ${how}${entry.note ? ` · ${entry.note}` : ""}`;
}
