import { Fingerprint } from "lucide-react";
import { prisma } from "@/lib/db";
import { deviceAddress, readClock, readDeviceUsers, type DeviceClock, type DeviceUser } from "@/lib/attendance-device";
import { mappedByDeviceUser } from "@/lib/attendance-store";
import { MAX_DRIFT_SECONDS } from "@/lib/attendance-sync";
import { setDeviceUserId } from "@/lib/actions/operations-actions";
import { getTimezone } from "@/lib/settings";
import { AttendanceConsole } from "@/components/admin/attendance-console";
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

export default async function AttendanceDevicePage() {
  const at = deviceAddress();
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
  const recent = await prisma.attendanceRecord.findMany({
    orderBy: [{ day: "desc" }],
    take: 15,
    include: { employee: { select: { name: true } } },
  });

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

      {/* --- What it has recorded ----------------------------------------- */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-bark/40">Recorded lately</h2>
      {recent.length === 0 ? (
        <p className="mt-2 text-sm text-bark/50">Nothing recorded yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-warm-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-clay-soft/40 text-xs uppercase tracking-wider text-bark/45">
              <tr>
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Hours late</th>
                <th className="px-4 py-3">Where it came from</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((row) => (
                <tr key={row.id} className="border-t border-warm-line">
                  <td className="px-4 py-3 text-bark/60">{row.day.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-3 font-medium text-bark">{row.employee.name}</td>
                  <td className="px-4 py-3 tabular-nums text-bark/60">{row.delayHours}</td>
                  <td className="px-4 py-3 text-xs text-bark/45">
                    {row.source === "DEVICE" ? "the device" : "typed by the manager"}
                    {row.note && <span className="text-bark/35"> · {row.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
