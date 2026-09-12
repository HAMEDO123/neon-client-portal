import { CircleHelp, CircleSlash, CircleUser, TriangleAlert, CircleCheck } from "lucide-react";
import { describeOutcome, type Outcome, type Verdict } from "@/lib/verification";
import { cn } from "@/lib/utils";

// What the check looked at, shown before the decision rather than instead of
// it.
//
// The colours carry the one distinction the whole feature rests on: "not met"
// is a fault in the work, "cannot tell" is a limit of the evidence. Giving them
// the same weight on screen would undo in a glance what the rules are careful
// about — so one is red and one is grey with a question mark, and the words
// say it too.

type Check = {
  id: string;
  required: string;
  evidence: string | null;
  verdict: string;
  gap: string | null;
};

const LOOK: Record<Verdict, { icon: typeof CircleCheck; tone: string; label: string }> = {
  met: { icon: CircleCheck, tone: "text-emerald-700 border-emerald-500/25 bg-emerald-500/[0.07]", label: "Shown" },
  partly: { icon: TriangleAlert, tone: "text-amber-700 border-amber-500/25 bg-amber-500/[0.07]", label: "Partly" },
  "not-met": { icon: CircleSlash, tone: "text-pink-strong border-pink/25 bg-pink/[0.06]", label: "Not done" },
  "cannot-tell": {
    icon: CircleHelp,
    tone: "text-ink/60 border-ink/15 bg-ink/[0.03]",
    label: "Evidence does not show",
  },
  "needs-human": { icon: CircleUser, tone: "text-purple-strong border-purple/25 bg-purple/[0.06]", label: "Your call" },
};

const UNKNOWN = LOOK["needs-human"];

export function SubmissionChecks({
  checks,
  outcome,
  checkedAt,
}: {
  checks: Check[];
  outcome: string | null;
  checkedAt: Date | null;
}) {
  // Nothing checked it yet — say so plainly rather than showing an empty box
  // that could be mistaken for "nothing wrong".
  if (!checkedAt) {
    return (
      <p className="mt-3 rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2 text-xs text-ink/45">
        Not checked against the acceptance criteria — this is yours to judge.
      </p>
    );
  }

  if (checks.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-800">
        Nothing is written under “Counts as done when” for this task, so there was nothing to check it against.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">
        Checked against what you asked for
        {outcome ? <span className="ml-1.5 normal-case text-ink/60">· {describeOutcome(outcome as Outcome)}</span> : null}
      </p>

      <ul className="mt-2 flex flex-col gap-1.5">
        {checks.map((check) => {
          const look = LOOK[check.verdict as Verdict] ?? UNKNOWN;

          return (
            <li key={check.id} className={cn("rounded-lg border px-3 py-2", look.tone)}>
              <div className="flex items-start gap-2">
                <look.icon size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p dir="auto" className="text-sm font-medium">
                    {check.required}
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide opacity-70">{look.label}</p>

                  {check.evidence && (
                    <p dir="auto" className="mt-1 text-xs opacity-80">
                      {check.evidence}
                    </p>
                  )}
                  {check.gap && (
                    <p dir="auto" className="mt-1 text-xs font-medium">
                      {check.gap}
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[11px] text-ink/35">
        A reading of the photo, not a decision. Approving and sending back are still yours.
      </p>
    </div>
  );
}
