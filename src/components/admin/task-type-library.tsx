import { ListChecks } from "lucide-react";
import { saveTaskType } from "@/lib/actions/task-actions";
import { TextArea, TextInput } from "@/components/admin/fields";
import { SaveButton } from "@/components/admin/form-buttons";
import { linesOf, mayAutoAccept, summaryOf, type TaskType } from "@/lib/task-types";

// What each kind of work needs, filled in once.
//
// A step is the same job on every project, so what to hand in, what counts as
// finished and what proof is expected belong to the step rather than to each
// cell of the board. A cell can still say something different; it simply no
// longer has to say anything at all.
//
// Plain forms and no client JavaScript: each step is a form that posts itself.
// The only state here is what is in the database.

type Step = TaskType & { id: string; name: string; sectionName: string | null };
type Person = { id: string; name: string };

export function TaskTypeLibrary({ steps, employees }: { steps: Step[]; employees: Person[] }) {
  return (
    <section className="glass rounded-2xl p-6">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <ListChecks size={16} strokeWidth={2} />
        What each kind of work needs
      </h2>
      <p className="mt-1 text-sm text-ink/50">
        Fill a step in once and every project gets it: what is handed in, what counts as finished, what proof to send,
        and how long it should take. A cell on the board can still say something different — it just no longer has to
        say anything at all. This is also what a submission is checked against, so a step nobody fills in is a step
        nothing can be checked against.
      </p>

      {steps.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-ink/15 px-4 py-6 text-center text-sm text-ink/40">
          No process steps yet — add them on the Tasks board and they appear here.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {steps.map((step) => (
            <li key={step.id} className="rounded-xl border border-ink/8 bg-white/50">
              <details className="group">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
                  <span className="font-medium text-ink">{step.name}</span>
                  {step.sectionName && <span className="text-xs text-ink/35">{step.sectionName}</span>}

                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    {summaryOf(step).length === 0 ? (
                      <span className="rounded-full border border-dashed border-ink/15 px-2 py-0.5 text-[11px] text-ink/35">
                        Nothing written yet
                      </span>
                    ) : (
                      summaryOf(step).map((part) => (
                        <span
                          key={part}
                          className="rounded-full border border-ink/10 bg-white px-2 py-0.5 text-[11px] text-ink/55"
                        >
                          {part}
                        </span>
                      ))
                    )}
                  </span>
                </summary>

                <form
                  action={saveTaskType.bind(null, step.id)}
                  className="grid grid-cols-1 gap-3 border-t border-ink/8 px-4 py-4 sm:grid-cols-2"
                >
                  <TextArea
                    className="sm:col-span-2"
                    label="What is handed in"
                    name="deliverable"
                    rows={2}
                    defaultValue={step.deliverable ?? ""}
                  />

                  {/* One per line, because each line is checked on its own. */}
                  <TextArea
                    className="sm:col-span-2"
                    label="What counts as finished — one per line"
                    name="acceptance"
                    rows={4}
                    defaultValue={step.acceptance ?? ""}
                  />

                  <TextArea
                    label="Proof to send"
                    name="evidence"
                    rows={3}
                    defaultValue={step.evidence ?? ""}
                  />
                  <TextArea
                    label="Checklist while doing it — one per line"
                    name="checklist"
                    rows={3}
                    defaultValue={step.checklist ?? ""}
                  />

                  <TextInput
                    label="Hours it should take"
                    name="estimateHours"
                    type="number"
                    defaultValue={step.estimateHours == null ? "" : String(step.estimateHours)}
                    required={false}
                  />

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-ink/50">Who normally reviews it</span>
                    <select
                      name="reviewerId"
                      defaultValue={step.reviewerId ?? ""}
                      className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
                    >
                      <option value="">The manager</option>
                      {employees.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* The one setting here that can do damage quietly, so it says
                      plainly what it does and what it will not do. */}
                  <div className="sm:col-span-2">
                    <label className="inline-flex items-start gap-2 text-sm text-ink/70">
                      <input
                        type="checkbox"
                        name="autoAccept"
                        defaultChecked={step.autoAccept}
                        className="mt-0.5 h-3.5 w-3.5 accent-ink"
                      />
                      <span>
                        Accept this automatically when every line above is shown
                        <span className="mt-0.5 block text-xs text-ink/40">
                          {linesOf(step.acceptance).length === 0
                            ? "Nothing will be accepted automatically until what counts as finished is written above — there would be nothing to check."
                            : mayAutoAccept(step)
                              ? "On. Work of this kind is accepted without anybody looking, but only when the evidence shows every line."
                              : "Off. Every submission waits for a person."}
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="sm:col-span-2">
                    <SaveButton label={`Save ${step.name}`} />
                  </div>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
