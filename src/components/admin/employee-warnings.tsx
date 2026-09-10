import { TriangleAlert } from "lucide-react";
import { giveWarning, removeWarning } from "@/lib/actions/warning-actions";
import { TextArea } from "@/components/admin/fields";
import { DeleteButton } from "@/components/admin/form-buttons";
import { WarningMeter } from "@/components/ui/warning-meter";
import { MAX_REASON_LENGTH, WARNING_LIMIT, warningStanding } from "@/lib/warnings";
import { formatDayIn, formatTimeIn } from "@/lib/time";

// Warnings on an employee's page: the ones on record, and the form that gives
// the next. The last one closes the account, so its button says so and asks
// before it goes.

type Warning = { id: string; reason: string; createdAt: Date };

export function EmployeeWarnings({
  employeeId,
  name,
  active,
  warnings,
  timezone,
}: {
  employeeId: string;
  name: string;
  active: boolean;
  warnings: Warning[];
  timezone: string;
}) {
  const standing = warningStanding(warnings.length);
  const firstName = name.split(" ")[0];
  const next = standing.count + 1;

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
          <TriangleAlert size={15} strokeWidth={2} />
          Warnings
        </h2>
        <WarningMeter count={standing.count} />
      </div>
      <p className="mt-1 text-xs text-ink/45">
        {firstName} is told on their phone the moment you give one, and sees it at the top of their home screen until
        you remove it. Warning {WARNING_LIMIT} of {WARNING_LIMIT} closes the account.
      </p>

      {warnings.length > 0 && (
        <ol className="mt-4 flex flex-col gap-2">
          {warnings.map((warning, index) => (
            <li key={warning.id} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="whitespace-pre-line text-sm text-ink">
                  {warning.reason}
                </p>
                <p className="mt-0.5 text-xs text-ink/45">
                  {formatDayIn(timezone, warning.createdAt)} {formatTimeIn(timezone, warning.createdAt)}
                </p>
              </div>
              <form>
                <DeleteButton
                  formAction={removeWarning.bind(null, employeeId, warning.id)}
                  label="Remove"
                  confirmMessage={`Remove this warning? ${firstName} will no longer see it.`}
                />
              </form>
            </li>
          ))}
        </ol>
      )}

      {!active ? (
        <p className="mt-4 rounded-lg bg-ink/[0.04] px-3 py-2 text-xs text-ink/55">
          The account is disabled{standing.reached ? ` after ${WARNING_LIMIT} warnings` : ""}. Enable it under Account
          access to give warnings again.
        </p>
      ) : standing.reached ? (
        <p className="mt-4 rounded-lg bg-ink/[0.04] px-3 py-2 text-xs text-ink/55">
          {firstName} already has {WARNING_LIMIT} warnings. Remove one before giving another.
        </p>
      ) : (
        <form className="mt-4">
          <TextArea
            label={standing.nextIsFinal ? "Reason for the final warning" : "Reason"}
            name="reason"
            rows={2}
            required
            maxLength={MAX_REASON_LENGTH}
          />
          <div className="mt-3">
            <DeleteButton
              formAction={giveWarning.bind(null, employeeId)}
              label={standing.nextIsFinal ? "Give final warning and close account" : `Give warning ${next} of ${WARNING_LIMIT}`}
              confirmMessage={
                standing.nextIsFinal
                  ? `This is ${firstName}'s warning ${next} of ${WARNING_LIMIT}. Sending it closes their account: they are told why, then they can no longer sign in. Send it?`
                  : `Send ${firstName} warning ${next} of ${WARNING_LIMIT}? It goes to their phone now.`
              }
            />
          </div>
        </form>
      )}
    </section>
  );
}
