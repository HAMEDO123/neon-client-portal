import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";
import { notifyAdmin } from "@/lib/admin-notifications";
import { recordStateChange } from "@/lib/task-state-log";
import { canMove } from "@/lib/task-transitions";
import { VISIT_TASK_REFUSAL, isVisitTask } from "@/lib/site-visit-task-store";
import { verifySubmission } from "@/lib/ai/verify-submission";
import type { TaskState } from "@/generated/prisma/enums";

// Handing in finished work, whichever screen it was handed in from.
//
// The web has done this from two nearly identical blocks — one for a cell on
// the project board, one for a job handed out by hand — and the phone needs
// the same thing a third time. Three copies of this would be three places for
// the parts that are easy to get wrong to drift: the move check, the storage
// rule that decides whether a PDF is allowed, the state that is deliberately
// not DONE, the record of the change, and the check that runs afterwards.
//
// So the caller does the one thing only it can — finding the work, scoped to
// the person asking — and hands over what it found. Nothing here re-derives
// ownership, exactly as `postChatMessage` does not re-derive who may post.

export type ProofSubject = {
  /** A cell on the project board, or a job the manager handed out. */
  kind: "entry" | "assigned";
  id: string;
  state: TaskState;
  /** What to call it when the manager is told. */
  name: string;
};

export type ProofResult =
  | { ok: true; submissionId: string }
  | { ok: false; error: string };

/**
 * Records the evidence and moves the work to SUBMITTED.
 *
 * Never DONE: that word belongs to the manager, and this returns a refusal
 * rather than throwing so a route can answer with a status and a page can show
 * a sentence.
 */
export async function submitProof(
  employee: { id: string; name: string },
  subject: ProofSubject,
  photo: File,
  note: string | null
): Promise<ProofResult> {
  // Sending proof is a move like any other: work already with the manager, or
  // already approved, must not be submitted again.
  const move = canMove(subject.state, "SUBMITTED", "employee", true);
  if (!move.ok) return { ok: false, error: move.reason };

  // A site visit is written up in the diary, where the client is asked and the
  // manager approves. A photo sent against its job would be a second record of
  // the same visit — so it is turned away here, the one place the website and
  // the phone both pass through.
  if (subject.kind === "assigned" && (await isVisitTask(subject.id))) {
    return { ok: false, error: VISIT_TASK_REFUSAL };
  }

  if (!(photo instanceof File) || photo.size === 0) {
    return { ok: false, error: "Attach a photo or a file of the finished work." };
  }

  // A PDF, a drawing or a spreadsheet is proof too, and the "image" rule would
  // reject every one of them. The kind follows the file: photos keep their EXIF
  // rotation and recompression, anything else is stored as it was sent.
  const kind = photo.type.startsWith("image/") ? "image" : "document";

  let saved: Awaited<ReturnType<typeof saveFile>>;
  try {
    saved = await saveFile(photo, `submissions/${employee.id}`, kind);
  } catch (error) {
    // saveFile refuses what it will not store and says what it accepts. That
    // sentence is the useful one, so it travels rather than being swallowed.
    return { ok: false, error: error instanceof Error ? error.message : "That file could not be saved." };
  }

  const submission = await prisma.taskSubmission.create({
    data: {
      ...(subject.kind === "entry" ? { entryId: subject.id } : { assignedTaskId: subject.id }),
      employeeId: employee.id,
      imageUrl: saved.url,
      note,
    },
    select: { id: true },
  });

  // Not DONE — that word belongs to the manager.
  if (subject.kind === "entry") {
    await prisma.projectTaskEntry.update({
      where: { id: subject.id },
      data: { state: "SUBMITTED", completedAt: null },
    });
  } else {
    await prisma.assignedTask.update({
      where: { id: subject.id },
      data: { state: "SUBMITTED", completedAt: null },
    });
  }

  await recordStateChange({
    ...(subject.kind === "entry" ? { entryId: subject.id } : { assignedTaskId: subject.id }),
    from: subject.state,
    to: "SUBMITTED",
    actor: "employee",
    actorEmployeeId: employee.id,
  });

  await notifyAdmin({
    type: "TASK_SUBMITTED",
    title: `${employee.name} finished a task`,
    message: `${subject.name}. A photo is waiting for your review.`,
    url: "/admin/reviews",
    dedupeKey: `TASK_SUBMITTED:${submission.id}`,
    entryId: subject.kind === "entry" ? subject.id : null,
    employeeId: employee.id,
  });

  // Checked against what was asked, in the background: reading a photo takes
  // long enough that waiting for it would leave the employee looking at a
  // spinner, and a check that fails must never undo work already handed in.
  // It writes only its own verdicts — never the task's state.
  void verifySubmission(submission.id).catch(() => null);

  return { ok: true, submissionId: submission.id };
}
