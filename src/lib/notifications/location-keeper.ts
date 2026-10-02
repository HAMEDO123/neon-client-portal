import { hasClockedOut, isOpen, KEEPER_MINUTES, whoToPing } from "@/lib/staff-location";
import { locationDay, pingCandidates, wakePhones, wipePositions } from "@/lib/mobile/location-service";
import { runLocationFines } from "@/lib/notifications/location-fines";

// The scheduler's half of the manager's map (lib/staff-location.ts decides,
// lib/mobile/location-service.ts reads and writes).
//
// Called every minute by the meeting scheduler (`?job=location`) and on every
// full pass. Two jobs, and the second is the one that matters:
// - while today's window is open, it wakes the phones that have not sent a
//   position for ten minutes and were not asked in the last ten — which is
//   also how the day starts, when nobody has sent one yet;
// - whenever the window is not open, it wipes every position. The map's read
//   already refuses to show one from outside the window, but not showing a
//   position is not the same as not keeping it, and nothing kept here may
//   outlive the working day. Somebody the device has seen clock out is wiped
//   at once, inside the window too.
//
// Then, on the same pass, the 1 JOD a working day without location
// (lib/notifications/location-fines.ts): the notice, the day's warnings while
// the window is open, and the day's charges once it has closed.
//
// Departures are read as the device sync stored them; the device itself is
// never asked from here.

export async function runLocationKeeper(now: Date = new Date()) {
  const today = await locationDay(now);
  const map = await keepPositions(now, today);
  // After the map's own work, and failing on its own: a charge that could not
  // be decided must never be the reason a position outlived the day.
  const fine = await runLocationFines(now, today).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  return { ...map, fine };
}

async function keepPositions(now: Date, today: Awaited<ReturnType<typeof locationDay>>) {
  if (!isOpen(today.window, now)) {
    return { open: false, wiped: await wipePositions() };
  }

  const people = await pingCandidates(today.day);
  const wiped = await wipePositions(
    people.filter((person) => hasClockedOut(person.departedAt, now)).map((person) => person.id)
  );
  const due = whoToPing({ now, window: today.window, people, quietMinutes: KEEPER_MINUTES });
  const asked = await wakePhones(due, now);

  return { open: true, due: due.length, asked, wiped };
}
