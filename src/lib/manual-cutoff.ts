import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { addManualDeduction, cancelDeduction } from "@/lib/deduction-store";
import { dispatchNotification } from "@/lib/notifications/engine";
import { Refusal } from "@/lib/refusal";
import { getTimezone } from "@/lib/settings";
import { manualCopy, readManualCutoff, takenBackCopy } from "@/lib/task-cutoff";
import { todayKey } from "@/lib/time";

// The manager's own cutoff and taking one back, written once for everybody who
// can ask for it: the payroll screen and the phone (lib/actions/deduction-actions.ts,
// behind requireAdmin) and the WhatsApp desk's assistant (api/desk/cutoff, behind
// DESK_SECRET, acting only on the manager's word in the team group).
// Deliberately not "use server": these trust their caller to have checked who is asking.

function refresh() {
  revalidatePath("/admin/payroll");
  revalidatePath("/employee", "layout");
}

/** Adds the cutoff and tells the person. Refuses in words when something is missing. */
export async function applyManualCutoff(input: {
  employeeId: string;
  hours: unknown;
  amount: unknown;
  reason: string;
  day?: string;
}) {
  const reason = input.reason.trim().slice(0, 300);
  const what = readManualCutoff({ hours: input.hours, amount: input.amount });

  if (!input.employeeId) throw new Refusal("Choose who it is for.");
  if (!what) throw new Refusal("Type how much: hours of pay, or an amount in JOD.");
  // The person is told the reason, and a deduction with none is one nobody can answer for.
  if (!reason) throw new Refusal("Write the reason — they are told it.");

  const dayKey = input.day && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : todayKey(await getTimezone());
  const row = await addManualDeduction({ employeeId: input.employeeId, dayKey, ...what, reason });
  if (!row) throw new Refusal("That person could not be found.");

  after(() =>
    dispatchNotification({
      employeeId: row.employeeId,
      type: "WARNING",
      ...manualCopy(row.amount, reason),
      url: "/employee",
      dedupeKey: `DEDUCTION:${row.id}`,
    }).catch(() => undefined)
  );
  refresh();
  return row;
}

/** Takes one cutoff back — the manager's own or an automatic one — and says so to the person. */
export async function takeBackCutoff(id: string) {
  const row = await cancelDeduction(id);
  if (!row) throw new Refusal("That one was already taken back.");

  after(() =>
    dispatchNotification({
      employeeId: row.employeeId,
      type: "WARNING",
      ...takenBackCopy(row.amount, row.reason),
      url: "/employee",
      dedupeKey: `DEDUCTION_BACK:${row.id}`,
    }).catch(() => undefined)
  );
  refresh();
  return row;
}
