import { NextResponse } from "next/server";
import { mobileEmployee } from "@/lib/mobile-auth";
import { setEmployeeTaskState } from "@/lib/task-status";
import type { TaskState } from "@/generated/prisma/enums";

// Starting a piece of work, or putting it back.
//
// Every state in the board's vocabulary is accepted here and then put to
// `canMove`, deliberately: asking for DONE comes back with "an employee cannot
// approve their own work" rather than "invalid value", which is the true
// answer and the one worth showing somebody.
//
// Reaching review is not on this route at all. That happens by sending proof —
// a photo — and a photo needs a multipart upload the mobile API does not have
// yet. `submissionClosesTask()` returns false and always will: sending work is
// the beginning of a check, not the end of one.

export const dynamic = "force-dynamic";

const STATES: TaskState[] = ["TODO", "IN_PROGRESS", "SUBMITTED", "DONE", "TOMORROW"];

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const employee = await mobileEmployee(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const asked = typeof body?.state === "string" ? body.state : "";

  if (!STATES.includes(asked as TaskState)) {
    return NextResponse.json({ error: "That is not a state." }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await setEmployeeTaskState(employee, id, asked as TaskState);

  if (!result.ok) {
    // "Task not found" is a 404; a refused move is a 409 — the task exists and
    // the move does not.
    const status = result.error === "Task not found." ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, changed: result.changed });
}
