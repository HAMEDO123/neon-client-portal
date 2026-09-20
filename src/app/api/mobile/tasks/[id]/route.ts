import { NextResponse } from "next/server";
import { mobileStaff } from "@/lib/mobile-auth";
import { taskForEmployee } from "@/lib/employee-tasks";
import { moveMyTask } from "@/lib/task-status";
import type { TaskState } from "@/generated/prisma/enums";

// One task, and the two moves an employee is allowed to make on it.

async function employeeOf(request: Request) {
  const staff = await mobileStaff(request);
  if (!staff || staff.type !== "EMPLOYEE") return null;
  return staff;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const employee = await employeeOf(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  // Scoped by ownership in the query, so a task belonging to somebody else
  // matches no rows and is a 404 — never a glimpse of it.
  const task = await taskForEmployee(employee.id, (await params).id);
  if (!task) return NextResponse.json({ error: "No such task." }, { status: 404 });

  return NextResponse.json({ task });
}

/**
 * Starting and un-starting work. Nothing else.
 *
 * An employee reaches review by sending proof, never by choosing the state,
 * and can never write DONE — `canMove` refuses it underneath this, so the rule
 * holds whatever this route is asked for. A refusal comes back as 409 with the
 * reason rather than as an error, because "that is already with the manager"
 * is an answer to show somebody, not a fault.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const employee = await employeeOf(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const state = typeof body?.state === "string" ? body.state : "";

  if (state !== "TODO" && state !== "IN_PROGRESS") {
    return NextResponse.json(
      { error: "An employee may only start or un-start work. Finishing is a photo, and approving is the manager's." },
      { status: 400 }
    );
  }

  const result = await moveMyTask(employee, (await params).id, state as TaskState);
  if (!result.moved) {
    const notFound = result.reason === "Task not found.";
    return NextResponse.json({ error: result.reason }, { status: notFound ? 404 : 409 });
  }

  return NextResponse.json({ moved: true, state });
}
