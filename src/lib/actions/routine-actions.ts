"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { prisma } from "@/lib/db";
import { Refusal, answering, type Answer } from "@/lib/refusal";
import { ensureTodaysRoutines } from "@/lib/routine-store";

// The manager's routine tasks (lib/routine-store.ts): what somebody does every
// working day. The manager's alone — a routine puts work on a person's list
// every day from then on.

function refresh() {
  revalidatePath("/admin/tasks");
  revalidatePath("/employee", "layout");
}

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;

/** Form: `employeeId`, `title`, and optionally `note`, `acceptance`, `priority`. */
export async function createRoutine(formData: FormData): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();

    const employeeId = String(formData.get("employeeId") ?? "");
    const title = String(formData.get("title") ?? "").trim().slice(0, 200);
    const priority = PRIORITIES.find((value) => value === formData.get("priority")) ?? "MEDIUM";

    if (!title) throw new Refusal("Write what the task is.");
    const person = await prisma.employee.findFirst({
      where: { id: employeeId, active: true, accessRole: "EMPLOYEE" },
      select: { id: true },
    });
    if (!person) throw new Refusal("Choose who does it.");

    const routine = await prisma.routineTask.create({
      data: {
        employeeId: person.id,
        title,
        note: String(formData.get("note") ?? "").trim().slice(0, 2000) || null,
        acceptance: String(formData.get("acceptance") ?? "").trim().slice(0, 2000) || null,
        priority,
      },
    });

    // On their list today, not from tomorrow — if today is a day the studio works.
    await ensureTodaysRoutines(new Date(), routine.id);
    refresh();
  });
}

/** Pauses a routine or brings it back. A paused one makes no more days; the days it made stay. */
export async function setRoutineActive(id: string, active: boolean): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();
    await prisma.routineTask.updateMany({ where: { id }, data: { active: Boolean(active) } });
    if (active) await ensureTodaysRoutines(new Date(), id);
    refresh();
  });
}

/** Removes a routine for good. The days already handed out stay as ordinary jobs. */
export async function deleteRoutine(id: string): Promise<Answer> {
  return answering(async () => {
    await requireAdmin();
    await prisma.routineTask.deleteMany({ where: { id } });
    refresh();
  });
}
