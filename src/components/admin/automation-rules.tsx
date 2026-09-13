import Link from "next/link";
import { Eye, Power, Radio } from "lucide-react";
import {
  createAutomationRule,
  deleteAutomationRule,
  setAutomationSwitch,
  updateAutomationRule,
} from "@/lib/actions/automation-actions";
import { ACTIONS, RECIPIENTS, TRIGGERS, TRIGGER_LABEL, type Action, type Recipient, type Trigger } from "@/lib/automation";
import { TextInput } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { buttonClasses } from "@/components/ui/buttons";
import { Badge } from "@/components/ui/badge";
import type { RuleRun } from "@/lib/notifications/automation-events";

// The studio's own rules: when to ask, when to tell, when to escalate.
//
// Plain forms, no client JavaScript. The preview is a link rather than a button
// for the same reason — it is a way of looking at the day, and looking at
// something should not need a round trip through a client component.

type Row = {
  id: string;
  name: string;
  trigger: string;
  atLeast: number;
  action: string;
  recipient: string;
  graceMinutes: number;
  cooldownMinutes: number;
  escalateAfterMinutes: number | null;
  enabled: boolean;
};

const ACTION_LABEL: Record<Action, string> = {
  ask: "Ask them about it",
  tell: "Tell somebody",
  escalate: "Escalate it",
};

const RECIPIENT_LABEL: Record<Recipient, string> = {
  "the-person": "The person themselves",
  "the-manager": "The manager",
};

export function AutomationRules({
  rules,
  switchedOn,
  preview,
}: {
  rules: Row[];
  switchedOn: boolean;
  preview: RuleRun | null;
}) {
  return (
    <section id="automation" className="glass rounded-2xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
            <Radio size={16} strokeWidth={2} />
            Rules that watch the day
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink/50">
            Conditions the platform can watch for — a day with no plan, work stuck on somebody else, a question nobody
            answered — and what to do about each: ask the person, tell you, or escalate when it has gone on too long.
            A rule can only ever say something. Nothing here can start, finish or approve work.
          </p>
        </div>

        <form action={setAutomationSwitch.bind(null, !switchedOn)}>
          <button type="submit" className={buttonClasses(switchedOn ? "outline" : "primary", "sm")}>
            <Power size={14} strokeWidth={2} />
            {switchedOn ? "Switch all rules off" : "Switch rules on"}
          </button>
        </form>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={switchedOn ? "success" : "neutral"}>{switchedOn ? "Running" : "Switched off"}</Badge>
        <span className="text-xs text-ink/45">
          {switchedOn
            ? "Rules that are on are considered every few minutes, with the day's follow-ups."
            : "Nothing is sent while this is off, whatever any individual rule says."}
        </span>
        <Link href="/admin/settings?preview=rules#automation" className={buttonClasses("outline", "sm")}>
          <Eye size={14} strokeWidth={2} />
          See what they would do
        </Link>
      </div>

      {/* What would have happened, worked out against today and sent nowhere. */}
      {preview && (
        <div className="mt-4 rounded-xl border border-ink/10 bg-white/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink/40">
            Preview · nothing was sent and nothing was recorded
          </p>
          {preview.lines.length === 0 ? (
            <p className="mt-2 text-sm text-ink/50">
              {preview.rules === 0 ? "No rules to try yet." : "Nothing to say about anybody today."}
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink/45">
                {preview.rules} {preview.rules === 1 ? "rule" : "rules"} against {preview.considered / Math.max(1, preview.rules)}{" "}
                people · {preview.sent} would speak · {preview.quiet} would stay quiet
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {preview.lines.map((line, index) => (
                  <li key={`${index}-${line}`} className="text-sm text-ink/70">
                    {line}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {rules.map((rule) => (
          <li key={rule.id} className="rounded-xl border border-ink/8 bg-white/50">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
                <span className="font-medium text-ink">{rule.name}</span>
                <span className="text-xs text-ink/40">
                  {TRIGGER_LABEL[rule.trigger as Trigger] ?? rule.trigger}
                </span>
                <span className="ml-auto">
                  <Badge tone={rule.enabled ? "success" : "neutral"}>{rule.enabled ? "On" : "Off"}</Badge>
                </span>
              </summary>

              <RuleFields rule={rule} action={updateAutomationRule.bind(null, rule.id)} label="Save changes">
                <DeleteButton
                  formAction={deleteAutomationRule.bind(null, rule.id)}
                  label="Delete"
                  confirmMessage={`Delete “${rule.name}”? What it remembers about people goes with it.`}
                />
              </RuleFields>
            </details>
          </li>
        ))}
      </ul>

      <details className="mt-3 rounded-xl border border-dashed border-ink/15 bg-white/40">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-ink/70">Add a rule</summary>
        <RuleFields action={createAutomationRule} label="Add rule" />
      </details>
    </section>
  );
}

/** The same fields whether a rule is being added or changed. */
function RuleFields({
  rule,
  action,
  label,
  children,
}: {
  rule?: Row;
  action: (formData: FormData) => Promise<void>;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <form action={action} className="grid grid-cols-1 gap-3 border-t border-ink/8 px-4 py-4 sm:grid-cols-2">
      <TextInput
        className="sm:col-span-2"
        label="What to call it"
        name="name"
        defaultValue={rule?.name ?? ""}
        placeholder="Chase a blocker that has not moved"
      />

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/50">Watch for</span>
        <select
          name="trigger"
          defaultValue={rule?.trigger ?? "blocked"}
          className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        >
          {TRIGGERS.map((trigger) => (
            <option key={trigger} value={trigger}>
              {TRIGGER_LABEL[trigger]}
            </option>
          ))}
        </select>
      </label>

      <TextInput
        label="Only when there are at least"
        name="atLeast"
        type="number"
        defaultValue={String(rule?.atLeast ?? 1)}
        required={false}
      />

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/50">Then</span>
        <select
          name="action"
          defaultValue={rule?.action ?? "ask"}
          className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        >
          {ACTIONS.map((option) => (
            <option key={option} value={option}>
              {ACTION_LABEL[option]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink/50">Who hears it</span>
        <select
          name="recipient"
          defaultValue={rule?.recipient ?? "the-person"}
          className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
        >
          {RECIPIENTS.map((option) => (
            <option key={option} value={option}>
              {RECIPIENT_LABEL[option]}
            </option>
          ))}
        </select>
      </label>

      <TextInput
        label="Wait this many minutes first"
        name="graceMinutes"
        type="number"
        defaultValue={String(rule?.graceMinutes ?? 0)}
        required={false}
      />
      <TextInput
        label="Then stay quiet for (minutes)"
        name="cooldownMinutes"
        type="number"
        defaultValue={String(rule?.cooldownMinutes ?? 0)}
        required={false}
      />
      <TextInput
        label="Escalate to you after (minutes, blank for never)"
        name="escalateAfterMinutes"
        type="number"
        defaultValue={rule?.escalateAfterMinutes == null ? "" : String(rule.escalateAfterMinutes)}
        required={false}
      />

      <label className="flex items-center gap-2 text-sm text-ink/70 sm:col-span-2">
        <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? false} className="h-3.5 w-3.5 accent-ink" />
        Turn this rule on
        <span className="text-xs text-ink/40">(the switch above still has to be on as well)</span>
      </label>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <SaveButton label={label} />
        {children}
      </div>
    </form>
  );
}
