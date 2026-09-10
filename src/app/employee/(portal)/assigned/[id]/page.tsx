import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarRange, Camera, ClipboardList, FileText, Flag } from "lucide-react";
import { requireEmployee } from "@/lib/employee-session";
import { myAssignedTask } from "@/lib/assigned-tasks";
import { submissionsForAssignedTask } from "@/lib/submissions";
import { getTimezone } from "@/lib/settings";
import { formatDayIn, formatTimeIn } from "@/lib/time";
import { dayLabel, daysBetween } from "@/lib/week";
import { EMPLOYEE_STATE_LABEL, PRIORITY_LABEL } from "@/lib/task-board";
import { StatusControl } from "@/components/employee/status-control";
import { CompletionForm } from "@/components/employee/completion-form";
import { Countdown } from "@/components/employee/countdown";

// One job the manager handed out directly.
//
// Laid out like a task from the board, and working the same way — status,
// proof, the manager's verdict — because the employee should not have to learn
// two sets of rules for two kinds of work.
export default async function AssignedTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireEmployee();
  const { id } = await params;

  // Scoped to this employee: somebody else's job id is simply not found.
  const task = await myAssignedTask(employee.id, id);
  if (!task) notFound();

  const timezone = await getTimezone();
  const submissions = await submissionsForAssignedTask(task.id);

  const days = daysBetween(task.startKey, task.endKey) + 1;
  const from = dayLabel(task.startKey);
  const to = dayLabel(task.endKey);
  const when =
    days === 1
      ? `${from.weekday} ${from.day} ${from.month}`
      : `${from.weekday} ${from.day} – ${to.weekday} ${to.day} ${to.month}`;

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
        <span className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-ink/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/50">
          <ClipboardList size={10} strokeWidth={2.5} />
          From the manager
        </span>
        <h1 dir="auto" className="mt-2 text-xl font-semibold text-ink">
          {task.title}
        </h1>
      </div>

      {/* The time left is the thing to act on, so it sits above the detail. */}
      {task.state !== "DONE" && (
        <Countdown dueDay={task.endKey} timeZone={timezone} size="large" className="self-start" />
      )}

      <div className="glass grid grid-cols-2 gap-3 rounded-2xl p-4">
        <Detail icon={Flag} label="Priority" value={PRIORITY_LABEL[task.priority]} />
        <Detail icon={ClipboardList} label="Status" value={EMPLOYEE_STATE_LABEL[task.state]} />
        <div className="col-span-2">
          <Detail
            icon={CalendarRange}
            label={days === 1 ? "Day" : `${days} days`}
            value={when}
          />
        </div>
      </div>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Update status</h2>
        <div className="mt-2">
          <StatusControl entryId={task.id} state={task.state} kind="assigned" />
        </div>
      </section>

      <CompletionForm entryId={task.id} state={task.state} kind="assigned" />

      {task.note && (
        <section className="glass rounded-2xl p-4">
          <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink/40">
            <FileText size={13} strokeWidth={2} />
            Notes from the manager
          </h2>
          <p dir="auto" className="mt-2 whitespace-pre-wrap text-sm text-ink/70">
            {task.note}
          </p>
        </section>
      )}

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
                    <p dir="auto" className="mt-1 text-sm text-ink/70">
                      {submission.reviewNote}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof Flag; label: string; value: string }) {
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
