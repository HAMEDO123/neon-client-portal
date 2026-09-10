import { ClipboardCheck } from "lucide-react";
import { pendingSubmissions } from "@/lib/submissions";
import { getTimezone } from "@/lib/settings";
import { formatDayIn, formatTimeIn } from "@/lib/time";
import { EmptyState } from "@/components/ui/empty-state";
import { ReviewActions } from "@/components/admin/review-actions";

// The evidence queue.
//
// Nothing on the board reads "Done" until it has passed through here: an
// employee sends a photo, it lands in this list, and approving it is what
// writes the completed state.
export default async function ReviewsPage() {
  const submissions = await pendingSubmissions();
  const timezone = await getTimezone();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Reviews</h1>
      <p className="mt-1 text-sm text-ink/50">
        Work your team says is finished, with the proof attached. Approving marks the task complete on the board;
        sending it back returns it to In Progress with your reason.
      </p>

      {submissions.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={ClipboardCheck}
          title="Nothing waiting"
          description="When someone finishes a task and sends a photo of it, it appears here."
        />
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {submissions.map((submission) => {
            // A board cell names its step and project; a hand-assigned job
            // has only its own title.
            const name = submission.entry?.task.name ?? submission.assignedTask?.title ?? "Task";
            const context = submission.entry?.project.name ?? "Handed out by you";

            return (
            <li key={submission.id} className="glass rounded-2xl p-4">
              <div className="flex flex-col gap-4 sm:flex-row">
                <a
                  href={submission.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block shrink-0 overflow-hidden rounded-xl border border-ink/10 sm:w-56"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={submission.imageUrl}
                    alt={`Proof for ${name}`}
                    className="h-44 w-full object-cover sm:h-40"
                  />
                </a>

                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">{context}</p>
                  <h2 dir="auto" className="mt-0.5 text-base font-semibold text-ink">
                    {name}
                  </h2>
                  <p className="mt-1 text-sm text-ink/55">
                    {submission.employee.name} · {formatDayIn(timezone, submission.createdAt)}{" "}
                    {formatTimeIn(timezone, submission.createdAt)}
                  </p>

                  {submission.note && (
                    <p dir="auto" className="mt-2 rounded-lg bg-ink/[0.04] px-3 py-2 text-sm text-ink/70">
                      {submission.note}
                    </p>
                  )}

                  <div className="mt-3">
                    <ReviewActions submissionId={submission.id} />
                  </div>
                </div>
              </div>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
