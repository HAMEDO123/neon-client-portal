"use server";

import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/lib/employee-session";
import { readClockFix } from "@/lib/app-clock";
import { recordAppPunch } from "@/lib/app-clock-store";
import { writeAppDay } from "@/lib/attendance-sync";
import { Refusal } from "@/lib/refusal";
import { getTimezone } from "@/lib/settings";
import { formatTimeIn } from "@/lib/time";

// Clocking in or out from the app, where you are (lib/app-clock.ts).
//
// The person is the signed-in one, never an argument. The position is theirs to
// send and is checked for being real and fresh; the time is the server's.

export type ClockAnswer = { ok: true; time: string } | { ok: false; error: string };

export async function clockFromApp(position: {
  latitude: unknown;
  longitude: unknown;
  accuracy: unknown;
  fixedAt: unknown;
}): Promise<ClockAnswer> {
  const employee = await requireEmployee();
  try {
    const now = new Date();
    const fix = readClockFix(position, now);
    const punch = await recordAppPunch(employee.id, fix, now);
    if (!punch.repeated) await writeAppDay(employee.id, now);

    revalidatePath("/employee");
    revalidatePath("/admin/attendance");
    revalidatePath("/admin/payroll");
    return { ok: true, time: formatTimeIn(await getTimezone(), punch.at) ?? "" };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    throw error;
  }
}
