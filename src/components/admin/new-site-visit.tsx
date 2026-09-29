"use client";

import { useState, useTransition } from "react";
import { MapPinned, Plus, X } from "lucide-react";
import { assignSiteVisit } from "@/lib/actions/site-visit-actions";

// The manager writing a visit down for somebody else.
//
// The other half of how a visit begins: the studio decides a client needs
// seeing, and whoever is going picks the day — they know their own week and
// how long the drive is. So the date is optional here, and the form says so
// rather than leaving somebody to guess whether an empty box will be refused.

type Keeper = { id: string; name: string };
type ProjectOption = { id: string; name: string; clientName: string | null };

export function NewSiteVisit({ keepers, projects }: { keepers: Keeper[]; projects: ProjectOption[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (keepers.length === 0) {
    // Nobody could act on it, so nothing is offered. Said plainly, because a
    // missing button with no reason reads as a broken screen.
    return (
      <p className="rounded-xl border border-dashed border-ink/12 px-3 py-2 text-xs text-ink/45">
        Nobody keeps the site-visit diary yet. Tick &ldquo;Keeps the site-visit diary&rdquo; on somebody under Team.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-bg"
      >
        <Plus size={16} strokeWidth={2.5} />
        New visit
      </button>
    );
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        start(async () => {
          try {
            await assignSiteVisit(formData);
            setOpen(false);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "That did not save.");
          }
        });
      }}
      className="rounded-2xl border border-warm-line bg-card p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-bark">
          <MapPinned size={15} strokeWidth={1.75} className="text-clay" />
          New site visit
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-md p-1 text-bark/30 hover:bg-bark/5 hover:text-bark"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="What the visit is for" wide>
          <input name="title" required dir="auto" placeholder="Measure the kitchen" className={INPUT} />
        </Field>

        <Field label="For">
          <select name="employeeId" defaultValue={keepers[0]?.id ?? ""} className={INPUT}>
            {keepers.map((keeper) => (
              <option key={keeper.id} value={keeper.id}>
                {keeper.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Client">
          <input name="clientName" dir="auto" placeholder="Ahmad Al-Masri" className={INPUT} />
        </Field>

        <Field label="Client's WhatsApp number">
          <input name="clientPhone" type="tel" inputMode="tel" placeholder="962 7 9999 9999" className={INPUT} />
        </Field>

        <Field label="Where">
          <input name="location" dir="auto" placeholder="Abdoun, behind the bakery" className={INPUT} />
        </Field>

        <Field label="Project (if it has one)">
          <select name="projectId" defaultValue="" className={INPUT}>
            <option value="">Not tied to a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.clientName ? ` — ${project.clientName}` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="When">
          <input type="datetime-local" name="scheduledAt" className={INPUT} />
          <span className="mt-1 block text-[11px] text-bark/40">
            Leave it empty and they pick the day themselves.
          </span>
        </Field>

        <Field label="What they should do there" wide>
          <textarea
            name="purpose"
            rows={2}
            dir="auto"
            placeholder="Check the ceiling height and take the window measurements"
            className={INPUT}
          />
        </Field>
      </div>

      {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-60"
      >
        Add the visit
      </button>
    </form>
  );
}

const INPUT =
  "mt-1 w-full rounded-lg border border-warm-line bg-white px-3 py-2 text-sm text-bark outline-none focus:border-clay";

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={wide ? "sm:col-span-2" : undefined}>
      <span className="block text-[11px] font-medium uppercase tracking-wider text-bark/40">{label}</span>
      {children}
    </label>
  );
}
