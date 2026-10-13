"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/admin-guard";
import { addManualDeduction, cancelDeduction } from "@/lib/deduction-store";
import { dispatchNotification } from "@/lib/notifications/engine";
import { Refusal, answering, type Answer } from "@/lib/refusal";
import { getTimezone, setSetting } from "@/lib/settings";
import { CUTOFF_ANNOUNCED, CUTOFF_SETTING, manualCopy, readManualCutoff, takenBackCopy } from "@/lib/task-cutoff";
import { prisma } from "@/lib/db";
import { todayKey } from "@/lib/time";

// The manager's own cutoffs, taking any cutoff back, and the switch for the
// nine o'clock rule. All three are the manager's alone: this is somebody's pay.
//
// Each answers in words rather than throwing them (lib/refusal.ts).

function refresh() {
  revalidatePath("/admin/payroll");
  revalidatePath("/employee", "layout");
}

/** Form: `employeeId`, `hours` or `amount`, `reason`, and optionally `day` (YYYY-MM-DD). */
export async function addCutoff(formData: FormData): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();

    const employeeId = String(formData.get("employeeId") ?? "");
    const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
    const what = readManualCutoff({ hours: formData.get("hours"), amount: formData.get("amount") });
    const typedDay = String(formData.get("day") ?? "");

    if (!employeeId) throw new Refusal("Choose who it is for.");
    if (!what) throw new Refusal("Type how much: hours of pay, or an amount in JOD.");
    // The person is told the reason, and a deduction with none is one nobody can answer for.
    if (!reason) throw new Refusal("Write the reason — they are told it.");

    const dayKey = /^\d{4}-\d{2}-\d{2}$/.test(typedDay) ? typedDay : todayKey(await getTimezone());
    const row = await addManualDeduction({ employeeId, dayKey, ...what, reason });
    if (!row) throw new Refusal("That person could not be found.");

    after(() =>
      dispatchNotification({
        employeeId,
        type: "WARNING",
        ...manualCopy(row.amount, reason),
        url: "/employee",
        dedupeKey: `DEDUCTION:${row.id}`,
      }).catch(() => undefined)
    );
    refresh();
  });
}

/** Takes one cutoff back — the manager's own or an automatic one — and says so to the person. */
export async function removeCutoff(id: string): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();

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
  });
}

/**
 * The nine o'clock rule, on or off. Turning it off forgets that it was
 * announced, so turning it on again tells everybody again and starts counting
 * from the day after — nobody is charged under a rule they were told had ended.
 */
export async function setTaskCutoff(on: boolean): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();
    if (typeof on !== "boolean") throw new Refusal("Say whether the rule is on or off.");

    await setSetting(CUTOFF_SETTING, on ? "true" : "false");
    if (!on) await prisma.appSetting.deleteMany({ where: { key: CUTOFF_ANNOUNCED } });
    refresh();
  });
}
