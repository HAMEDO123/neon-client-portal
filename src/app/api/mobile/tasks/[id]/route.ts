import { NextResponse } from "next/server";
import { mobileEmployee } from "@/lib/mobile-auth";
import { taskForEmployee } from "@/lib/employee-tasks";

// One task, with everything the person doing it needs: what to hand in, what
// counts as done, what it waits on, and the step's own standard where the cell
// says nothing of its own.
//
// `taskForEmployee` is scoped by ownership, so an id belonging to somebody else
// is not found rather than refused — the app cannot probe for other people's
// work by trying ids.

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const employee = await mobileEmployee(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await context.params;
  const task = await taskForEmployee(employee.id, id);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  return NextResponse.json({ task });
}
