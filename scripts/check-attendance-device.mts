import { attendanceFromPunches } from "@/lib/attendance";
import { deviceAddress, readClock, readDeviceUsers, readPunches } from "@/lib/attendance-device";
import { mappedByDeviceUser } from "@/lib/attendance-store";
import { getTimezone, getWorkHours } from "@/lib/settings";

// Asks the fingerprint device what it knows and prints what a sync *would* do,
// without writing a single row.
//
// This exists because the device is the one part of attendance that cannot be
// tested: it is a box on a wall with its own clock and its own idea of who
// people are. When attendance looks wrong, run this before changing any code —
// it answers "is it reachable", "is its clock right", "who is enrolled", "who
// is paired" and "what would today have recorded" in one pass.
//
//   node --env-file=.env.local --import tsx scripts/check-attendance-device.mts

const at = deviceAddress();
if (!at) {
  console.log("No ATTENDANCE_DEVICE_IP set — attendance is switched off on this machine.");
  process.exit(0);
}

console.log(`device: ${at.ip}:${at.port}`);

const now = new Date();
const clock = await readClock(at, now);
console.log(`clock : ${clock.deviceTime.toISOString()}  (out by ${clock.driftSeconds}s)`);
if (Math.abs(clock.driftSeconds) > 600) {
  console.log("        ^ too far out — a sync would refuse to write anything.");
}

const users = await readDeviceUsers(at);
const mapped = await mappedByDeviceUser();

console.log(`\nenrolled on the device (${users.length}):`);
for (const user of users) {
  const person = mapped.get(user.deviceUserId);
  const who = person ? `→ ${person.name}${person.active ? "" : " (no longer on the team)"}` : "→ NOT PAIRED";
  console.log(`  ${user.deviceUserId.padEnd(4)} ${user.name.padEnd(14)} ${user.isAdmin ? "[admin]" : "       "} ${who}`);
}

const paired = [...mapped.values()];
console.log(`\npaired in the platform (${paired.length}):`);
for (const person of paired) console.log(`  ${person.name}${person.active ? "" : " (inactive)"}`);

const punches = await readPunches(at);
const hours = await getWorkHours();
const timeZone = await getTimezone();
const days = attendanceFromPunches(punches, hours, timeZone);

console.log(`\nlog: ${punches.length} punches → ${days.length} working days`);

const byYear: Record<string, number> = {};
for (const day of days) {
  const year = day.dayKey.slice(0, 4);
  byYear[year] = (byYear[year] ?? 0) + 1;
}
console.log(`days by year: ${JSON.stringify(byYear)}`);

const wouldWrite = days.filter((day) => mapped.get(day.deviceUserId)?.active);
const wouldSkip = days.filter((day) => !mapped.has(day.deviceUserId));
console.log(`\nwould write ${wouldWrite.length} rows; ${wouldSkip.length} days belong to nobody paired.`);

console.log("\nthe ten most recent days a sync would record:");
for (const day of wouldWrite.slice(-10)) {
  const person = mapped.get(day.deviceUserId);
  console.log(
    `  ${day.dayKey}  ${(person?.name ?? "?").padEnd(14)} arrived ${day.arrivedAt
      .toISOString()
      .slice(11, 16)}Z  late ${day.delayHours}h  (${day.punches} reads)`
  );
}

console.log("\nNothing was written. This script only reads.");
