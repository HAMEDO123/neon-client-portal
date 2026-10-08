import { notifyAdmin } from "@/lib/admin-notifications";
import { deviceIsSilent, silentCopy, silentKey } from "@/lib/attendance-find";
import { LAST_SYNC_KEY, type SyncReport } from "@/lib/attendance-sync";
import { getSetting, getTimezone, getWorkHours } from "@/lib/settings";
import { dayKeyIn, instantAt } from "@/lib/time";
import { isWorkingDay } from "@/lib/work-hours";

// Telling the manager the fingerprint device has gone quiet.
//
// For four days in October 2026 the device could not be read — its address had
// changed — and the only places that said so were a scheduler's log line and a
// screen nobody had a reason to open. Attendance stopped, the clock reminders
// stopped (they say nothing on stale data, by design), and the studio found
// out by noticing.
//
// The platform now looks for the device itself (lib/attendance-locate.ts), so
// this is for the day there is nothing to find: unplugged, switched off, the
// network down. Once a day, during working hours, in words about what NEON can
// see — the rules are `deviceIsSilent` and `silentCopy` in
// lib/attendance-find.ts, pure and tested.
//
// It never throws into the pass that calls it.

export async function tellIfDeviceSilent(report: SyncReport, now = new Date()): Promise<{ told: boolean }> {
  try {
    // Read, or deliberately not configured, or answering with a wrong clock:
    // none of those is silence. A wrong clock is its own fault with its own words.
    if (report.ran || report.reason !== "unreachable") return { told: false };

    const timeZone = await getTimezone();
    const hours = await getWorkHours();
    const dayKey = dayKeyIn(timeZone, now);
    const start = instantAt(dayKey, hours.start, timeZone);
    const end = instantAt(dayKey, hours.end, timeZone);
    const working = isWorkingDay(hours, dayKey) && Boolean(start && end && now >= start && now < end);

    const last = await getSetting(LAST_SYNC_KEY);
    const lastReadAt = last && !Number.isNaN(new Date(last).getTime()) ? new Date(last) : null;
    if (!deviceIsSilent({ lastReadAt, now, working })) return { told: false };

    const sent = await notifyAdmin({
      type: "ATTENDANCE",
      ...silentCopy(lastReadAt, timeZone),
      url: "/admin/attendance",
      dedupeKey: silentKey(dayKey),
    });
    return { told: Boolean(sent?.created) };
  } catch {
    return { told: false };
  }
}
