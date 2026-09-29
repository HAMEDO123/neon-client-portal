"use client";

import { useState, useTransition } from "react";
import { CalendarDays, Check, MapPin, MessageCircle, Plus, Trash2, User, X } from "lucide-react";
import {
  deleteSiteVisit,
  reportSiteVisit,
  scheduleSiteVisit,
  updateSiteVisit,
} from "@/lib/actions/site-visit-actions";
import type { SiteVisitView } from "@/lib/site-visit-queries";
import { STATE_LABEL, STATE_TONE, awaitingReport } from "@/lib/site-visits";
import type { SiteVisitState } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

// The site-visit diary, for whoever keeps it.
//
// Two halves on one screen, because they are two halves of one thing: what is
// coming up, and what came of what already happened. A visit whose time has
// passed with nothing written against it sits at the top with the words to
// answer it, which is the only nudge the platform gives — it never decides
// that somebody went.

type ProjectOption = { id: string; name: string; clientName: string | null };

export function SiteVisits({
  visits,
  projects,
}: {
  visits: SiteVisitView[];
  projects: ProjectOption[];
}) {
  // null = closed; { visit: null } = writing a new one.
  const [form, setForm] = useState<{ visit: SiteVisitView | null } | null>(null);
  const [answering, setAnswering] = useState<{ visit: SiteVisitView; state: SiteVisitState } | null>(null);
  const [pending, start] = useTransition();

  const owed = visits.filter((visit) => awaitingReport(visit));
  const rest = visits.filter((visit) => !awaitingReport(visit));

  return (
    <div className={cn("flex flex-col gap-4", pending && "opacity-95")}>
      <button
        type="button"
        onClick={() => setForm({ visit: null })}
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-sm font-semibold text-bg transition-opacity active:opacity-90"
      >
        <Plus size={18} strokeWidth={2.5} />
        Schedule a site visit
      </button>

      {owed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-700">
            Waiting on your write-up
          </h2>
          {owed.map((visit) => (
            <VisitCard
              key={visit.id}
              visit={visit}
              owed
              onEdit={() => setForm({ visit })}
              onAnswer={(state) => setAnswering({ visit, state })}
            />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        {rest.length === 0 && owed.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-ink/12 px-4 py-10 text-center text-sm text-ink/40">
            No site visits written down yet.
          </p>
        ) : (
          rest.map((visit) => (
            <VisitCard
              key={visit.id}
              visit={visit}
              owed={false}
              onEdit={() => setForm({ visit })}
              onAnswer={(state) => setAnswering({ visit, state })}
            />
          ))
        )}
      </section>

      {form && (
        <VisitDialog
          visit={form.visit}
          projects={projects}
          onClose={() => setForm(null)}
          onDelete={(id) => {
            setForm(null);
            start(async () => {
              await deleteSiteVisit(id);
            });
          }}
        />
      )}

      {answering && (
        <AnswerDialog
          visit={answering.visit}
          state={answering.state}
          onClose={() => setAnswering(null)}
        />
      )}
    </div>
  );
}

function VisitCard({
  visit,
  owed,
  onEdit,
  onAnswer,
}: {
  visit: SiteVisitView;
  owed: boolean;
  onEdit: () => void;
  onAnswer: (state: SiteVisitState) => void;
}) {
  const planned = visit.state === "PLANNED";

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white/70 p-3",
        owed ? "border-amber-500/40" : "border-ink/8"
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span dir="auto" className="block text-sm font-medium text-ink">
            {visit.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/45">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={12} strokeWidth={1.75} />
              {when(visit.scheduledAt)}
            </span>
            {visit.location && (
              <span dir="auto" className="inline-flex items-center gap-1">
                <MapPin size={12} strokeWidth={1.75} />
                {visit.location}
              </span>
            )}
            {(visit.clientName || visit.project?.clientName) && (
              <span dir="auto" className="inline-flex items-center gap-1">
                <User size={12} strokeWidth={1.75} />
                {visit.clientName ?? visit.project?.clientName}
              </span>
            )}
            {visit.project && <span dir="auto">{visit.project.name}</span>}
          </span>
        </span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", STATE_TONE[visit.state])}>
          {STATE_LABEL[visit.state]}
        </span>
      </div>

      {visit.purpose && (
        <p dir="auto" className="mt-2 whitespace-pre-wrap text-xs text-ink/60">
          {visit.purpose}
        </p>
      )}

      {visit.report && (
        <p dir="auto" className="mt-2 rounded-xl bg-ink/[0.04] px-3 py-2 text-xs text-ink/70">
          <span className="font-semibold text-ink/45">
            {visit.state === "MISSED" ? "Why not: " : "What came of it: "}
          </span>
          <span className="whitespace-pre-wrap">{visit.report}</span>
        </p>
      )}

      {/* What became of the review request. Said either way: a client nobody
          asked must not look like one who has not answered yet. */}
      {visit.reviewNote && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-ink/45">
          <MessageCircle size={12} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span dir="auto">{visit.reviewNote}</span>
        </p>
      )}

      {planned && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onAnswer("REPORTED")}
            className="flex-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
          >
            Visit ended
          </button>
          <button
            type="button"
            onClick={() => onAnswer("MISSED")}
            className="flex-1 rounded-xl border border-ink/12 bg-white px-3 py-2 text-xs font-semibold text-ink/70"
          >
            Did not go
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-xl border border-ink/12 bg-white px-3 py-2 text-xs font-medium text-ink/60"
          >
            Edit
          </button>
        </div>
      )}
    </article>
  );
}

/** Writing a visit down, or changing one nobody has answered for yet. */
function VisitDialog({
  visit,
  projects,
  onClose,
  onDelete,
}: {
  visit: SiteVisitView | null;
  projects: ProjectOption[];
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Sheet title={visit ? "Edit the visit" : "New site visit"} onClose={onClose}>
      <form
        action={(formData) => {
          setError(null);
          start(async () => {
            try {
              if (visit) await updateSiteVisit(visit.id, formData);
              else await scheduleSiteVisit(formData);
              onClose();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "That did not save.");
            }
          });
        }}
      >
        <Field label="What is the visit for">
          <input
            name="title"
            defaultValue={visit?.title ?? ""}
            autoFocus
            dir="auto"
            placeholder="Measure the kitchen"
            className={INPUT}
          />
        </Field>

        <Field label="When">
          <input
            type="datetime-local"
            name="scheduledAt"
            defaultValue={localValue(visit?.scheduledAt)}
            className={INPUT}
          />
        </Field>

        <Field label="Where">
          <input
            name="location"
            defaultValue={visit?.location ?? ""}
            dir="auto"
            placeholder="Abdoun, behind the bakery"
            className={INPUT}
          />
        </Field>

        <Field label="Client">
          <input
            name="clientName"
            defaultValue={visit?.clientName ?? ""}
            dir="auto"
            placeholder="Ahmad Al-Masri"
            className={INPUT}
          />
        </Field>

        {/* The number the review is asked of when the visit ends. A linked
            project fills it in when this is left blank. */}
        <Field label="Client's WhatsApp number">
          <input
            name="clientPhone"
            type="tel"
            inputMode="tel"
            defaultValue={visit?.clientPhone ?? ""}
            placeholder="962 7 9999 9999"
            className={INPUT}
          />
        </Field>

        <Field label="Project (if it has one)">
          <select name="projectId" defaultValue={visit?.project?.id ?? ""} className={INPUT}>
            <option value="">Not tied to a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
                {project.clientName ? ` — ${project.clientName}` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="What you plan to do there">
          <textarea
            name="purpose"
            rows={3}
            defaultValue={visit?.purpose ?? ""}
            dir="auto"
            placeholder="Check the ceiling height and take the window measurements"
            className={INPUT}
          />
        </Field>

        {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}

        <div className="mt-4 flex items-center gap-2">
          {visit && (
            <button
              type="button"
              onClick={() => onDelete(visit.id)}
              aria-label="Delete this visit"
              className="rounded-lg p-2 text-red-500/70 hover:bg-red-50"
            >
              <Trash2 size={15} strokeWidth={1.75} />
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="ml-auto rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-bg disabled:opacity-60"
          >
            {visit ? "Save" : "Schedule it"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/**
 * Saying what happened.
 *
 * The box is the point of the whole screen, so it is the only thing in the
 * sheet: a visit marked as made with nothing written is a tick where an
 * account should be, and the action refuses it.
 */
function AnswerDialog({
  visit,
  state,
  onClose,
}: {
  visit: SiteVisitView;
  state: SiteVisitState;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const went = state === "REPORTED";

  return (
    <Sheet title={went ? "What came of the visit?" : "Why did it not happen?"} onClose={onClose}>
      <p dir="auto" className="mb-3 text-xs text-ink/45">
        {visit.title} · {when(visit.scheduledAt)}
      </p>

      <form
        action={(formData) => {
          setError(null);
          start(async () => {
            try {
              await reportSiteVisit(visit.id, state, formData);
              onClose();
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "That did not save.");
            }
          });
        }}
      >
        <textarea
          name="report"
          rows={5}
          autoFocus
          dir="auto"
          placeholder={
            went
              ? "What you saw, what was decided, what happens next"
              : "What got in the way, and whether it is being rescheduled"
          }
          className={INPUT}
        />

        {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}

        {went && (
          <p className="mt-3 text-[11px] text-ink/45">
            The client is asked on WhatsApp how the visit went, and the manager sees it here to approve.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className={cn(
            "mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60",
            went ? "bg-emerald-600" : "bg-ink"
          )}
        >
          {went ? <Check size={16} strokeWidth={2.5} /> : <X size={16} strokeWidth={2.5} />}
          {went ? "End the visit" : "Mark as not visited"}
        </button>
      </form>
    </Sheet>
  );
}

const INPUT =
  "mt-1 w-full rounded-lg border border-ink/12 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-cyan-strong";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 block first:mt-0">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-ink/40">{label}</span>
      {children}
    </label>
  );
}

/** A sheet on a phone, a dialog on a desk — the shape the rest of the portal uses. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0" />

      <div className="relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_24px_60px_-20px_rgba(21,19,31,0.35)]">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink/30 hover:bg-ink/5 hover:text-ink"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** The value a datetime-local input wants: local wall clock, no zone. */
function localValue(at: Date | undefined): string {
  const when = at ?? new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(
    when.getMinutes()
  )}`;
}

function when(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}
