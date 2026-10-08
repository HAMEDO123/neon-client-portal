import { ChevronRight, Fingerprint } from "lucide-react";
import { prisma } from "@/lib/db";
import { readClock, readDeviceUsers, type DeviceClock, type DeviceUser } from "@/lib/attendance-device";
import { currentDeviceAddress } from "@/lib/attendance-locate";
import { mappedByDeviceUser } from "@/lib/attendance-store";
import { MAX_DRIFT_SECONDS } from "@/lib/attendance-sync";
import { buildMonth, monthBounds, monthKeyFor, type MonthEntry } from "@/lib/attendance-month";
import { setDeviceUserId } from "@/lib/actions/operations-actions";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { dateToDayKey, dayKeyToDate, formatDayIn, formatTimeIn, todayKey } from "@/lib/time";
import { AttendanceConsole } from "@/components/admin/attendance-console";
import { AttendanceMonth } from "@/components/admin/attendance-month";
import { DeviceUsers } from "@/components/admin/device-users";
import { SaveButton } from "@/components/admin/form-buttons";

// The fingerprint machine's own screen: is it there, is its clock right, who is
// enrolled on it, who those people are here, and what it has recorded lately.
//
// This page does read the device on render, which the payroll screen
// deliberately does not — that is the difference between a page about payroll
// and a page about the machine. It is written to degrade rather than fail: an
// unplugged device makes this say so, in place of the status, and everything
// else on the page still works.

export const dynamic = "force-dynamic";

export default async function AttendanceDevicePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: askedMonth } = await searchParams;
  // Where it is now — the router can move it, and the platform follows.
  const at = await currentDeviceAddress();
  const timezone = await getTimezone();

  let clock: DeviceClock | null = null;
  let users: DeviceUser[] = [];
  let reachError: string | null = null;

  if (at) {
    try {
      // One after the other: the device holds few connections and refuses new
      // ones once they are used up.
      clock = await readClock(at, timezone);
      users = await readDeviceUsers(at);
    } catch (error) {
      reachError = error instanceof Error ? error.message : String(error);
    }
  }

  const mapped = await mappedByDeviceUser();
  const employees = await prisma.employee.findMany({
    // Everybody the device can be paired to, the manager included — this screen
    // is where that pairing is managed, so excluding them here would make their
    // own number unpairable.
    where: { active: true },
    orderBy: { order: "asc" },
    select: { id: true, name: true, role: true, deviceUserId: true },
  });
  // The month on screen, and everything recorded in it. The bounds are day keys
  // turned into the UTC midnights the `@db.Date` column actually stores, so the
  // query never depends on the server's own offset — the same conversion the
  // sync writes with.
  const thisMonth = todayKey(timezone).slice(0, 7);
  const monthKey = monthKeyFor(askedMonth, todayKey(timezone));
  const bounds = monthBounds(monthKey);
  const workHours = await getWorkHours();

  const monthRecords = await prisma.attendanceRecord.findMany({
    where: { day: { gte: dayKeyToDate(bounds.from), lte: dayKeyToDate(bounds.to) } },
    orderBy: [{ day: "asc" }],
    include: { employee: { select: { id: true, name: true, active: true } } },
  });

  const entries: MonthEntry[] = monthRecords.flatMap((row) => {
    const dayKey = dateToDayKey(row.day);
    // A row with no readable day is left out rather than placed somewhere: a
    // day in the wrong column is worse than a day missing from the grid.
    return dayKey
      ? [
          {
            employeeId: row.employeeId,
            dayKey,
            delayHours: row.delayHours,
            earlyHours: row.earlyHours,
            // A departure the device actually recorded, not an assumption
            // about a day that has none.
            clockedOut: row.departedAt !== null,
            source: row.source,
            note: row.note,
          },
        ]
      : [];
  });

  // Everybody on the team now, plus anybody who has a day this month and has
  // since left — their month must still read correctly rather than losing its
  // days because they are no longer on the list.
  const seen = new Set(employees.map((person) => person.id));
  const people = [
    ...employees.map((person) => ({ id: person.id, name: person.name, active: true })),
    ...monthRecords
      .map((row) => row.employee)
      .filter((person) => !seen.has(person.id) && (seen.add(person.id), true))
      .map((person) => ({ id: person.id, name: person.name, active: person.active })),
  ];

  const month = buildMonth({ monthKey, hours: workHours, todayKey: todayKey(timezone), people, entries });

  const driftBad = clock ? Math.abs(clock.driftSeconds) > MAX_DRIFT_SECONDS : false;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-bark">Attendance device</h1>
      <p className="mt-1 text-sm text-bark/50">
        The fingerprint machine on the wall. It records arrivals; payroll turns them into hours late. A figure you
        type on the payroll screen is never overwritten by it.
      </p>

      {/* --- Is it there, and is its clock right? ------------------------- */}
      <div className="mt-6 rounded-2xl border border-warm-line bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-medium text-bark">
          <Fingerprint size={16} strokeWidth={1.75} className="shrink-0 text-clay" />
          {at ? `${at.ip}:${at.port}` : "No device configured"}
        </p>

        {!at && (
          <p className="mt-2 text-xs text-bark/55">
            Set ATTENDANCE_DEVICE_IP for this to do anything. Without it the scheduled pass simply does nothing,
            which is the right behaviour on a machine that has no device.
          </p>
        )}

        {reachError && (
          <p className="mt-2 text-xs text-amber-700">
            The device did not answer: {reachError}. It may be switched off, or on a different network from this
            server.
          </p>
        )}

        {clock && (
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            <Fact label="Its clock reads">{clock.wallClock}</Fact>
            <Fact label="Out by">
              <span className={driftBad ? "text-amber-700" : undefined}>
                {Math.abs(clock.driftSeconds) < 90
                  ? `${clock.driftSeconds}s`
                  : `${Math.round(clock.driftSeconds / 60)} minutes`}
              </span>
            </Fact>
            <Fact label="Enrolled">{users.length}</Fact>
          </dl>
        )}

        {driftBad && (
          <p className="mt-3 text-xs text-amber-700">
            Nothing will be recorded while it is this far out — the times would be wrong. Press “Set its clock”. If
            it keeps drifting back, its backup battery needs replacing.
          </p>
        )}
      </div>

      <AttendanceConsole />

      {/* --- Who the device knows, and the three things that change it ---- */}
      <DeviceUsers
        users={users.map((user) => ({
          uid: user.uid,
          deviceUserId: user.deviceUserId,
          name: user.name,
          isAdmin: user.isAdmin,
        }))}
        paired={[...mapped.values()].map((person) => ({
          deviceUserId: person.deviceUserId as string,
          name: person.name,
          active: person.active,
        }))}
        canReach={Boolean(at) && !reachError}
      />

      {/* --- Pairing ------------------------------------------------------ */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-bark/40">Pair people</h2>
      <p className="mt-1 text-xs text-bark/45">
        By the device’s number, never by name: the two lists of names rarely match, and a wrong pair takes money
        from the wrong person with nothing on screen to say why.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {employees.map((employee) => (
          <form
            key={employee.id}
            action={setDeviceUserId.bind(null, employee.id)}
            className="flex items-center gap-2 rounded-xl border border-warm-line bg-card px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-bark">
              {employee.name}
              {employee.role && <span className="ml-1.5 text-xs text-bark/40">{employee.role}</span>}
            </span>
            <input
              name="deviceUserId"
              defaultValue={employee.deviceUserId ?? ""}
              placeholder="number"
              inputMode="numeric"
              aria-label={`Device number for ${employee.name}`}
              className="w-20 rounded-lg border border-warm-line bg-paper-soft px-2 py-1.5 text-sm text-bark outline-none focus:border-clay"
            />
            <SaveButton label="Pair" />
          </form>
        ))}
      </div>

      {/* --- What it has recorded, a month at a time ---------------------- */}
      <AttendanceMonth month={month} thisMonth={thisMonth} />

      <ClockTimes rows={monthRecords} timezone={timezone} monthKey={monthKey} />
    </div>
  );
}

/**
 * When each person actually touched the machine, to the minute.
 *
 * The grid above answers "was anybody in on the 3rd"; this answers the other
 * question a manager opens this screen with — "what time did they come in, and
 * what time did they leave". A tooltip was not enough: it cannot be read down
 * a column, and it is the first thing asked when somebody disputes an hour.
 *
 * Newest first, because the day being argued about is almost always today.
 */
function ClockTimes({
  rows,
  timezone,
  monthKey,
}: {
  rows: {
    id: string;
    day: Date;
    arrivedAt: Date | null;
    departedAt: Date | null;
    delayHours: number;
    earlyHours: number;
    source: string;
    employee: { name: string };
  }[];
  timezone: string;
  monthKey: string;
}) {
  const withTimes = [...rows].filter((row) => row.arrivedAt !== null);

  // One section per day, newest first, people alphabetical inside it. A flat
  // list of every read in a month is the same information and unreadable: the
  // question is nearly always "what happened on this day", and a month of rows
  // makes that a scroll rather than a glance.
  const byDay = new Map<string, typeof withTimes>();
  for (const row of withTimes) {
    const key = dateToDayKey(row.day) ?? "";
    byDay.set(key, [...(byDay.get(key) ?? []), row]);
  }

  const days = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dayKey, entries]) => ({
      dayKey,
      entries: [...entries].sort((a, b) => a.employee.name.localeCompare(b.employee.name)),
      // What the day cost, so a closed section still answers the question the
      // screen is opened with.
      hoursOff:
        Math.round(entries.reduce((total, row) => total + row.delayHours + row.earlyHours, 0) * 100) / 100,
      missing: entries.filter((row) => row.departedAt === null).length,
    }));

  return (
    <section className="mt-6 rounded-2xl border border-warm-line bg-card p-5">
      <h2 className="text-sm font-medium text-bark">Clock in and out · {monthKey}</h2>
      <p className="mt-0.5 text-xs text-bark/45">
        The times the machine read, on the studio&rsquo;s own clock. Only days the device recorded appear here — a
        figure you typed has an amount but no times.
      </p>

      {days.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-warm-line px-3 py-6 text-center text-xs text-bark/40">
          No reads recorded this month yet.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {days.map((day, index) => (
            // `details` rather than a state hook: this page is rendered on the
            // server, and a disclosure that needs no JavaScript is one that
            // works before the page has finished loading.
            <details
              key={day.dayKey}
              open={index === 0}
              className="group rounded-xl border border-warm-line/70 bg-paper-soft/40 open:bg-paper-soft/70"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-sm">
                <ChevronRight
                  size={14}
                  strokeWidth={2}
                  className="shrink-0 text-bark/30 transition-transform group-open:rotate-90"
                />
                <span className="font-medium tabular-nums text-bark">
                  {formatDayIn(timezone, dayKeyToDate(day.dayKey))}
                </span>
                <span className="text-xs text-bark/40">
                  {day.entries.length} {day.entries.length === 1 ? "person" : "people"}
                </span>

                <span className="ml-auto flex items-center gap-3 text-xs">
                  {day.missing > 0 && (
                    <span className="text-amber-700">
                      {day.missing} no clock-out
                    </span>
                  )}
                  <span
                    className={day.hoursOff > 0 ? "font-medium tabular-nums text-amber-700" : "tabular-nums text-bark/30"}
                  >
                    {day.hoursOff > 0 ? `${day.hoursOff}h off` : "full days"}
                  </span>
                </span>
              </summary>

              <div className="overflow-x-auto border-t border-warm-line/60 px-3 pb-2">
                <table className="w-full min-w-[26rem] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wider text-bark/35">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Employee</th>
                      <th className="py-2 pr-3 font-medium">In</th>
                      <th className="py-2 pr-3 font-medium">Out</th>
                      <th className="py-2 text-right font-medium">Hours off</th>
                    </tr>
                  </thead>
                  <tbody>
                    {day.entries.map((row) => {
                      const off = Math.round((row.delayHours + row.earlyHours) * 100) / 100;
                      return (
                        <tr key={row.id} className="border-t border-warm-line/50">
                          <td className="py-2 pr-3 font-medium text-bark">{row.employee.name}</td>
                          <td className="py-2 pr-3 tabular-nums text-bark/70">
                            {formatTimeIn(timezone, row.arrivedAt)}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {row.departedAt ? (
                              <span className="text-bark/70">{formatTimeIn(timezone, row.departedAt)}</span>
                            ) : (
                              // Said in words rather than left blank: a blank
                              // here reads as "stayed to the end", which is the
                              // one thing the device cannot tell anybody.
                              <span className="text-amber-700">no clock-out</span>
                            )}
                          </td>
                          <td
                            className={`py-2 text-right tabular-nums ${off > 0 ? "font-medium text-amber-700" : "text-bark/30"}`}
                          >
                            {off > 0 ? `${off}h` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-bark/40">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-bark">{children}</dd>
    </div>
  );
}
