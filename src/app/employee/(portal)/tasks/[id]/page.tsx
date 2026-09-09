import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarDays, Camera, Clock, FileText, Flag } from "lucide-react";
import { requireEmployee } from "@/lib/employee-session";
import { taskForEmployee } from "@/lib/employee-tasks";
import { saveMyTaskNote } from "@/lib/actions/employee-actions";
import { getTimezone } from "@/lib/settings";
import { formatDayIn, formatTimeIn } from "@/lib/time";
import { EMPLOYEE_STATE_LABEL, PRIORITY_LABEL } from "@/lib/task-board";
import { StatusControl } from "@/components/employee/status-control";
import { CompletionForm } from "@/components/employee/completion-form";
import { submissionsForEntry } from "@/lib/submissions";
import { SaveButton } from "@/components/admin/form-buttons";

export default async function EmployeeTaskDetail({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireEmployee();
  const { id } = await params;

  // Scoped to this employee: another employee's task id is simply not found.
  const task = await taskForEmployee(employee.id, id);
  if (!task) notFound();

  const timezone = await getTimezone();
  const submissions = await submissionsForEntry(task.id);
  const due = formatTimeIn(timezone, task.dueAt);
  const dueDay = formatDayIn(timezone, task.dueAt);
  const scheduled = formatDayIn(timezone, task.scheduledFor);

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

      <div className="glass grid grid-cols-2 gap-3 rounded-2xl p-4">
        <Detail icon={Flag} label="Priority" value={PRIORITY_LABEL[task.priority]} />
        <Detail icon={CalendarDays} label="Status" value={EMPLOYEE_STATE_LABEL[task.state]} />
        <Detail icon={CalendarDays} label="Scheduled" value={scheduled ?? "Not scheduled"} />
        <Detail
          icon={Clock}
          label="Deadline"
          value={due ? `${dueDay ?? ""} ${due}`.trim() : "No deadline"}
        />
      </div>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Update status</h2>
        <div className="mt-2">
          <StatusControl entryId={task.id} state={task.state} />
        </div>
      </section>

      <CompletionForm entryId={task.id} state={task.state} />

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
