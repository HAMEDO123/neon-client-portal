import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mobileEmployee } from "@/lib/mobile-auth";
import { taskForEmployee } from "@/lib/employee-tasks";
import { submitProof } from "@/lib/task-proof";

// Handing in finished work from the phone.
//
// The one thing the app could not do. `/tasks/[id]/status` takes a state and
// no file, and at NEON finishing a task *is* sending a photo of it — so
// without this the employee side of the app could ask for a task, show it, and
// never complete the loop. A bare SUBMITTED is not a substitute: the manager's
// review queue would fill with claims and no evidence.
//
// Multipart, with the same field names the web form posts:
//   photo  — required. An image, or a PDF, drawing, spreadsheet or ZIP.
//   note   — optional, what the manager should know.
//
// The work itself goes through `submitProof`, which is the same path both web
// screens take: the move check, the storage rule, SUBMITTED and never DONE,
// the record of the change, and the check against what was asked.
//
// The id may be either kind of work — a cell on the project board or a job
// handed out by hand — and both are looked up scoped to the person asking, so
// somebody else's task is not found rather than refused.

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const employee = await mobileEmployee(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return NextResponse.json(
      { error: "Send this as multipart/form-data with a `photo` field." },
      { status: 415 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "That upload could not be read." }, { status: 400 });
  }

  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: "Attach a photo or a file of the finished work." }, { status: 400 });
  }

  const { id } = await context.params;
  const note = String(formData.get("note") ?? "").trim().slice(0, 1000) || null;

  // A board cell first, then a job handed out by hand. Both are scoped to this
  // employee, so an id belonging to somebody else matches neither.
  const entry = await taskForEmployee(employee.id, id);
  if (entry) {
    const result = await submitProof(
      employee,
      { kind: "entry", id: entry.id, state: entry.state, name: `${entry.task.name} — ${entry.project.name}` },
      photo,
      note
    );
    return result.ok
      ? NextResponse.json({ ok: true, submissionId: result.submissionId, state: "SUBMITTED" })
      : NextResponse.json({ error: result.error }, { status: 409 });
  }

  const job = await prisma.assignedTask.findFirst({
    where: { id, employeeId: employee.id },
    select: { id: true, title: true, state: true },
  });
  if (!job) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const result = await submitProof(
    employee,
    { kind: "assigned", id: job.id, state: job.state, name: job.title },
    photo,
    note
  );

  return result.ok
    ? NextResponse.json({ ok: true, submissionId: result.submissionId, state: "SUBMITTED" })
    : NextResponse.json({ error: result.error }, { status: 409 });
}
