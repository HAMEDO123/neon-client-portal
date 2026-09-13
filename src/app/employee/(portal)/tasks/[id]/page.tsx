import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Camera,
  Clock,
  FileText,
  Flag,
  Hourglass,
  ListChecks,
  OctagonAlert,
  PackageCheck,
} from "lucide-react";
import { effectiveDetail, linesOf } from "@/lib/task-types";
import { requireEmployee } from "@/lib/employee-session";
import { taskForEmployee } from "@/lib/employee-tasks";
import { saveMyTaskNote } from "@/lib/actions/employee-actions";
import { getTimezone } from "@/lib/settings";
import { formatDayIn, formatTimeIn } from "@/lib/time";
import { EMPLOYEE_STATE_LABEL, PRIORITY_LABEL } from "@/lib/task-board";
import { effortLabel, readinessLabel, readinessOf, readinessReason } from "@/lib/task-readiness";
import { StatusControl } from "@/components/employee/status-control";
import { CompletionForm } from "@/components/employee/completion-form";
import { FollowUpReply } from "@/components/employee/follow-up-reply";
import { openFollowUpForTask } from "@/lib/follow-up-queue";
import { submissionsForEntry } from "@/lib/submissions";
import { planForTasks } from "@/lib/stage-deadlines";
import { Countdown } from "@/components/employee/countdown";
import { SaveButton } from "@/components/admin/form-buttons";

export default async function EmployeeTaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireEmployee();
  const { id } = await params;

  // Scoped to this employee: another employee's task id is simply not found.
  const task = await taskForEmployee(employee.id, id);
  if (!task) notFound();

  const timezone = await getTimezone();
  const submissions = await submissionsForEntry(task.id);
  const dueBy = (await planForTasks([task])).get(task.id)?.dueBy ?? null;
  // A question the day has already asked about this task and is still waiting
  // on. Answering it is the first thing on the page, above everything else.
  const asking = await openFollowUpForTask(employee.id, task.id);
  const due = formatTimeIn(timezone, task.dueAt);
  const dueDay = formatDayIn(timezone, task.dueAt);
  const scheduled = formatDayIn(timezone, task.scheduledFor);

  // Ready, blocked, or waiting on something else — read off the facts rather
  // than stored, so it is right the moment the task before this one finishes.
  const readiness = readinessOf({
    state: task.state,
    blockedReason: task.blockedReason,
    blockedByName: task.blockedBy?.name ?? null,
    dependencies: task.waitsFor.map((row) => ({
      name: row.dependsOn.task.name,
      done: row.dependsOn.state === "DONE",
    })),
  });
  const holdUp = readinessReason(readiness);
  const effort = effortLabel(task.estimateHours);

  // What this task actually asks for: the cell's own words where the manager
  // wrote them here, and the step's standard where they did not. Filling a step
  // in once in Settings is what puts this in front of everybody working it.
  const applies = effectiveDetail(task, task.task);
  const checklist = linesOf(task.task.checklist);
  const proof = task.task.evidence?.trim() || null;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/employee/tasks"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/45 hover:text-ink"
      >
        <ArrowLeft size={15} strokeWidth={2} />
        My tasks
      </Link>

      <div>
        <h1 className="text-xl font-semibold text-ink">{task.task.name}</h1>
        <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-ink/50">
          <Building2 size={14} strokeWidth={1.75} />
          {task.project.name}
          {task.project.clientName ? ` · ${task.project.clientName}` : ""}
        </p>
      </div>

      {/* The time left is the thing to act on, so it sits above the detail
          rather than inside it. */}
      {dueBy && task.state !== "DONE" && (
        <Countdown dueBy={dueBy.toISOString()} timeZone={timezone} size="large" className="self-start" />
      )}

      {/* Why it cannot be picked up, where that is the case: the reason is on
          the task itself rather than something to go and ask about. */}
      {(readiness.status === "blocked" || readiness.status === "waiting") && (
        <section
          className={
            readiness.status === "blocked"
              ? "rounded-2xl border border-pink/25 bg-pink/[0.06] p-4"
              : "rounded-2xl border border-amber-300 bg-amber-50 p-4"
          }
        >
          <p
            className={
              readiness.status === "blocked"
                ? "inline-flex items-center gap-2 text-sm font-semibold text-pink-strong"
                : "inline-flex items-center gap-2 text-sm font-semibold text-amber-900"
            }
          >
            <OctagonAlert size={16} strokeWidth={2.25} />
            {readinessLabel(readiness)}
          </p>
          {holdUp && (
            <>
              {/* dir="auto": the reason is as often Arabic as English, and it
                  reads in its own direction rather than the page's. */}
              <p dir="auto" className="mt-1 text-sm text-ink/70">
                {holdUp.reason}
              </p>
              {holdUp.who && <p className="mt-1 text-xs text-ink/50">{holdUp.who} can clear it</p>}
            </>
          )}
        </section>
      )}

      <div className="glass grid grid-cols-2 gap-3 rounded-2xl p-4">
        <Detail icon={Flag} label="Priority" value={PRIORITY_LABEL[task.priority]} />
        <Detail icon={CalendarDays} label="Status" value={EMPLOYEE_STATE_LABEL[task.state]} />
        <Detail icon={CalendarDays} label="Scheduled" value={scheduled ?? "Not scheduled"} />
        <Detail
          icon={Clock}
          label="Deadline"
          value={due ? `${dueDay ?? ""} ${due}`.trim() : "No deadline"}
        />
        {effort && <Detail icon={Hourglass} label="Expected" value={effort} />}
      </div>

      {(applies.deliverable.value || applies.acceptance.value) && (
        <section className="glass rounded-2xl p-4">
          <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
            <PackageCheck size={13} strokeWidth={2} />
            What counts as finished
          </h2>
          {applies.deliverable.value && (
            <p dir="auto" className="mt-2 whitespace-pre-wrap text-sm text-ink/75">
              {applies.deliverable.value}
            </p>
          )}
          {/* One line, one thing: each of these is checked on its own when the
              photo arrives, so showing them as a block of prose would hide that
              they are separate items somebody has to satisfy. */}
          {applies.acceptance.value && (
            <ul className="mt-2 flex flex-col gap-1.5 border-t border-ink/8 pt-2">
              {linesOf(applies.acceptance.value).map((line, index) => (
                <li key={`${index}-${line}`} dir="auto" className="flex gap-2 text-sm text-ink/65">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink/25" />
                  {line}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* How this kind of work is normally done, where somebody wrote it down.
          A reminder, not a form: nothing here is ticked and nothing is recorded,
          because a box that gets ticked becomes a claim, and a claim in this
          system has exactly one route — the photo. */}
      {checklist.length > 0 && (
        <section className="glass rounded-2xl p-4">
          <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
            <ListChecks size={13} strokeWidth={2} />
            How we do this one
          </h2>
          <ol className="mt-2 flex flex-col gap-1.5">
            {checklist.map((line, index) => (
              <li key={`${index}-${line}`} dir="auto" className="flex gap-2 text-sm text-ink/70">
                <span className="mt-px text-[11px] font-semibold tabular-nums text-ink/30">{index + 1}</span>
                {line}
              </li>
            ))}
          </ol>
        </section>
      )}

      {(task.lastUpdateNote || task.nextStep) && (
        <section className="glass rounded-2xl p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Where it stands</h2>
          {task.lastUpdateNote && (
            <p dir="auto" className="mt-2 whitespace-pre-wrap text-sm text-ink/75">
              {task.lastUpdateNote}
            </p>
          )}
          {task.lastUpdateAt && (
            <p className="mt-1 text-[11px] text-ink/40">
              {formatDayIn(timezone, task.lastUpdateAt)} · {formatTimeIn(timezone, task.lastUpdateAt)}
            </p>
          )}
          {task.nextStep && (
            <div className="mt-2 border-t border-ink/8 pt-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">Next</p>
              <p dir="auto" className="mt-0.5 text-sm text-ink/70">
                {task.nextStep}
              </p>
            </div>
          )}
        </section>
      )}

      {asking && <FollowUpReply followUpId={asking.id} kind={asking.kind} />}

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Update status</h2>
        <div className="mt-2">
          <StatusControl entryId={task.id} state={task.state} />
        </div>
      </section>

      <CompletionForm entryId={task.id} state={task.state} evidence={proof} />

      {submissions.length > 0 && (
        <section className="glass rounded-2xl p-4">
          <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
            <Camera size={13} strokeWidth={2} />
            What you sent
          </h2>
          <ul className="mt-3 flex flex-col gap-3">
            {submissions.map((submission) => (
              <li key={submission.id} className="flex gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={submission.imageUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded-lg border border-ink/10 object-cover"
                />
                <div className="min-w-0 flex-1">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      submission.status === "APPROVED"
                        ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700"
                        : submission.status === "REJECTED"
                          ? "border-pink/20 bg-pink/10 text-pink-strong"
                          : "border-purple/20 bg-purple/10 text-purple-strong"
                    }`}
                  >
                    {submission.status === "PENDING" ? "Waiting for review" : submission.status.toLowerCase()}
                  </span>
                  <p className="mt-1 text-[11px] text-ink/40">
                    {formatDayIn(timezone, submission.createdAt)} · {formatTimeIn(timezone, submission.createdAt)}
                  </p>
                  {submission.reviewNote && (
                    <p className="mt-1 text-sm text-ink/70">{submission.reviewNote}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {task.adminNote && (
        <section className="glass rounded-2xl p-4">
          <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
            <FileText size={13} strokeWidth={2} />
            Notes from admin
          </h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink/70">{task.adminNote}</p>
        </section>
      )}

      <form action={saveMyTaskNote.bind(null, task.id)} className="glass rounded-2xl p-4">
        <label htmlFor="employeeNote" className="text-xs font-semibold uppercase tracking-wider text-ink/40">
          My notes
        </label>
        <textarea
          id="employeeNote"
          name="employeeNote"
          rows={4}
          defaultValue={task.employeeNote ?? ""}
          placeholder="Anything worth recording about this task…"
          className="mt-2 w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        />
        <div className="mt-3 flex justify-end">
          <SaveButton label="Save note" />
        </div>
      </form>
    </div>
  );
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Flag;
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink/40">
        <Icon size={12} strokeWidth={2} />
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-ink">{value}</p>
    </div>
  );
}
