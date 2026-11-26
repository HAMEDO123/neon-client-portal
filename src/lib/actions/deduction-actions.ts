"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { applyManualCutoff, takeBackCutoff } from "@/lib/manual-cutoff";
import { Refusal, answering, type Answer } from "@/lib/refusal";
import { setSetting } from "@/lib/settings";
import { CUTOFF_ANNOUNCED, CUTOFF_SETTING } from "@/lib/task-cutoff";
import { prisma } from "@/lib/db";

// The manager's own cutoffs, taking any cutoff back, and the switch for the
// nine o'clock rule. All three are the manager's alone: this is somebody's pay.
// The cutoff itself is written in lib/manual-cutoff.ts, shared with the desk's assistant.
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
    await applyManualCutoff({
      employeeId: String(formData.get("employeeId") ?? ""),
      hours: formData.get("hours"),
      amount: formData.get("amount"),
      reason: String(formData.get("reason") ?? ""),
      day: String(formData.get("day") ?? ""),
    });
  });
}

/** Takes one cutoff back — the manager's own or an automatic one — and says so to the person. */
export async function removeCutoff(id: string): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();
    await takeBackCutoff(id);
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
