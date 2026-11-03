import { ListChecks } from "lucide-react";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/employee-session";
import { allTasks } from "@/lib/employee-tasks";
import { getProjectById } from "@/lib/queries";
import { getTimezone } from "@/lib/settings";
import { planForTasks } from "@/lib/stage-deadlines";
import { TaskCard } from "@/components/employee/task-card";
import { EmptyState } from "@/components/ui/empty-state";

// This project's steps that are this person's to do.
//
// **Where they used to be listed is the whole of this page's reason.** They
// were cards in `/employee/tasks`, mixed in with the jobs somebody had been
// handed by name, and the studio asked on 2026-11-03 that they stop appearing
// there: "any task ممكن يكون عن طريق جدول المشاريع ما تنزلوا تاسك على حدا.
// يعني ما يبينش عندهم كتاسك". A step of the delivery process is the project's
// work, and it is read on the project.
//
// Nothing about the work itself moved. The same `TaskCard`, the same deadline
// from the stage plan, the same detail page at `/employee/tasks/[id]` with its
// states, its proof uploads and its questions, and the same notifications.
// Only the list it appears in changed — which is why this page is a query and
// a map and nothing else.
//
// Unfiltered on purpose, where the Tasks tab has six buttons: this is one
// project, so the whole of it is a short list, and "what is left on this
// project" is the question somebody opens it with.

export default async function EmployeeProjectStepsPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireEmployee();
  const { id } = await params;

  // Checked again here, like every surface in this codebase, rather than
  // trusting the layout above it.
  const project = await getProjectById(id);
  if (!project) notFound();

  const timezone = await getTimezone();
  // Scoped by `ownedBy` inside allTasks, so somebody opening a project they
  // hold no step on sees an empty list rather than the team's work.
  const steps = await allTasks(employee.id, undefined, id);
  const plan = await planForTasks(steps);

  const open = steps.filter((step) => step.state !== "DONE").length;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">My steps on this project</h2>
        <p className="mt-1 text-sm text-ink/50">
          {steps.length === 0
            ? "Steps of the delivery process that are yours to do appear here."
            : `${open} still to do, ${steps.length} in all. Open one to start it, send it for review or ask about it.`}
        </p>
      </div>

      {steps.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No steps are yours on this project"
          description="A step is yours when it names you, when you hold its section on this project, or when you are the step's standing owner."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {steps.map((step) => (
            <TaskCard
              key={step.id}
              task={step}
              timezone={timezone}
              dueBy={plan.get(step.id)?.dueBy}
              startsAt={plan.get(step.id)?.startsAt}
            />
          ))}
        </div>
      )}
    </section>
  );
}
