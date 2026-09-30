import { MapPinned } from "lucide-react";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { requireAdmin } from "@/lib/admin-guard";
import { allSiteVisits, projectsForVisits, siteVisitKeepers } from "@/lib/site-visit-queries";
import { getTimezone } from "@/lib/settings";
import { formatDayIn, formatTimeIn } from "@/lib/time";
import { STATE_LABEL, STATE_TONE, awaitingApproval, awaitingReport, isUpcoming, needsDate } from "@/lib/site-visits";
import { NewSiteVisit } from "@/components/admin/new-site-visit";
import { VisitDecision } from "@/components/admin/visit-decision";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

// Where the studio has been, and what came of it.
//
// The diary is written by whoever keeps it; this is the reading of it, and it
// is read-only on purpose. Saying that somebody went, or what a visit
// produced, is worth exactly as much as the fact that the person who went
// wrote it — a manager able to fill that in would be a manager able to invent
// it.
//
// Three groups, in the order they are worth looking at: visits whose time has
// passed with nothing written, what is coming up, and the record.

export const dynamic = "force-dynamic";

export default async function SiteVisitsPage() {
  await requireAdmin();

  const timezone = await getTimezone();
  const visits = await allSiteVisits();
  const keepers = await siteVisitKeepers();
  const projects = await projectsForVisits();

  const waiting = visits.filter((visit) => awaitingApproval(visit));
  const owed = visits.filter((visit) => awaitingReport(visit));
  const undated = visits.filter((visit) => needsDate(visit));
  const upcoming = visits.filter((visit) => isUpcoming(visit));
  const settled = visits.filter(
    (visit) =>
      !awaitingApproval(visit) && !awaitingReport(visit) && !needsDate(visit) && !isUpcoming(visit)
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Site visits</h1>
      <p className="mt-1 text-sm text-ink/50">
        What the team scheduled, whether they went, and what came of it. Written by whoever went — nothing here is
        filled in for them. A finished visit waits for you: the client is asked on WhatsApp how it went, and their
        reply arrives in the WhatsApp tab.
      </p>

      {/* Either side can start one: you write down that a client needs seeing,
          and whoever is going picks the day — or you set it yourself. */}
      <div className="mt-6">
        <NewSiteVisit keepers={keepers} projects={projects} />
      </div>

      {visits.length === 0 ? (
        <EmptyState
          className="mt-8"
          icon={MapPinned}
          title="No site visits yet"
          description="When somebody schedules a visit, it appears here with what they planned to do — and afterwards, what came of it."
        />
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          <Group
            title="Waiting for you"
            hint="Finished, written up, and the client has been asked how it went. Approve it when their answer satisfies you, or send it back."
            visits={waiting}
            timezone={timezone}
            tone="amber"
          />
          <Group
            title="Not written up yet"
            hint="The time has passed and nobody has said what happened. That is all it means — it is not a record of anybody missing a visit."
            visits={owed}
            timezone={timezone}
            tone="amber"
          />
          <Group
            title="Waiting for a day"
            hint="Written down, with the day left to whoever is going."
            visits={undated}
            timezone={timezone}
          />
          <Group title="Coming up" visits={upcoming} timezone={timezone} />
          <Group title="Done" visits={settled} timezone={timezone} />
        </div>
      )}
    </div>
  );
}

function Group({
  title,
  hint,
  visits,
  timezone,
  tone,
}: {
  title: string;
  hint?: string;
  visits: Awaited<ReturnType<typeof allSiteVisits>>;
  timezone: string;
  tone?: "amber";
}) {
  if (visits.length === 0) return null;

  return (
    <section>
      <h2 className={cn("text-sm font-semibold", tone === "amber" ? "text-amber-700" : "text-ink")}>
        {title}
        <span className="ml-2 text-xs font-normal text-ink/40">{visits.length}</span>
      </h2>
      {hint && <p className="mt-0.5 text-xs text-ink/45">{hint}</p>}

      <ul className="mt-3 flex flex-col gap-3">
        {visits.map((visit) => (
          <li
            key={visit.id}
            className={cn(
              "rounded-2xl border bg-white/70 p-4",
              tone === "amber" ? "border-amber-500/40" : "border-ink/8"
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p dir="auto" className="text-sm font-medium text-ink">
                  {visit.title}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/45">
                  <span className="inline-flex items-center gap-1.5 font-medium text-ink/60">
                    <PersonAvatar
                      name={visit.employee.name}
                      photo={visit.employee.photoUrl}
                      color={visit.employee.color}
                      size={18}
                    />
                    {visit.employee.name}
                  </span>
                  <span>
                    {visit.scheduledAt
                      ? `${formatDayIn(timezone, visit.scheduledAt)} · ${formatTimeIn(timezone, visit.scheduledAt)}`
                      : "No day set yet"}
                  </span>
                  {visit.location && <span dir="auto">{visit.location}</span>}
                  {visit.project && <span dir="auto">{visit.project.name}</span>}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                  STATE_TONE[visit.state]
                )}
              >
                {STATE_LABEL[visit.state]}
              </span>
            </div>

            {visit.purpose && (
              <p dir="auto" className="mt-3 whitespace-pre-wrap text-sm text-ink/60">
                <span className="font-semibold text-ink/40">Planned to: </span>
                {visit.purpose}
              </p>
            )}

            {visit.report && (
              <p dir="auto" className="mt-3 whitespace-pre-wrap rounded-xl bg-ink/[0.04] px-3 py-2.5 text-sm text-ink/75">
                <span className="font-semibold text-ink/40">
                  {visit.state === "MISSED" ? "Why not: " : "What came of it: "}
                </span>
                {visit.report}
              </p>
            )}

            {/* Whether the client was actually asked. Said either way, because
                "no reply yet" and "nobody asked them" are different facts and
                only one of them is the client's doing. */}
            {visit.reviewNote && (
              <p className="mt-2 text-xs text-ink/45">
                <span className="font-semibold text-ink/35">Review: </span>
                {visit.reviewNote}
              </p>
            )}

            {awaitingApproval(visit) && <VisitDecision id={visit.id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
