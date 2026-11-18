import Image from "next/image";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getTimezone } from "@/lib/settings";
import { formatDayIn } from "@/lib/time";
import { cn } from "@/lib/utils";

// A project at a glance, at the top of its Overview (the new UI, "everything
// by project", 2026-11-18): the work still open on it and who holds each piece,
// and the newest photos in its gallery — the two things somebody opening a
// project wants before any form. Shared by the manager's screen and the team's;
// `portal` only decides where the links go.

const STATE_LABEL: Record<string, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  SUBMITTED: "In review",
  TOMORROW: "Tomorrow",
};

const STATE_TONE: Record<string, string> = {
  TODO: "bg-ink/[0.06] text-ink/70",
  IN_PROGRESS: "bg-clay-soft text-clay-deep",
  SUBMITTED: "bg-emerald-100 text-emerald-900",
  TOMORROW: "bg-amber-100 text-amber-900",
};

export async function ProjectGlance({ projectId, portal }: { projectId: string; portal: "/admin" | "/employee" }) {
  // One after the other, like every multi-query page here.
  const steps = await prisma.projectTaskEntry.findMany({
    where: { projectId, state: { not: "DONE" }, excludedFromProgress: false, assigneeId: { not: null } },
    orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
    take: 6,
    select: {
      id: true,
      state: true,
      dueAt: true,
      task: { select: { name: true } },
      assignee: { select: { name: true } },
    },
  });
  const photos = await prisma.galleryImage.findMany({
    where: { space: { projectId } },
    orderBy: { createdAt: "desc" },
    take: 4,
    select: { id: true, imageUrl: true, caption: true, createdAt: true, space: { select: { name: true } } },
  });
  const timezone = await getTimezone();

  if (steps.length === 0 && photos.length === 0) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="glass rounded-2xl p-5 lg:col-span-2">
        <h2 className="text-lg text-ink">Work on this project</h2>
        {steps.length === 0 ? (
          <p className="mt-3 text-sm text-ink/50">Nothing open is assigned to anybody right now.</p>
        ) : (
          <ul className="mt-2 flex flex-col">
            {steps.map((step) => (
              <li key={step.id} className="flex items-center gap-3 border-b border-ink/8 py-2.5 last:border-b-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-clay-soft text-xs font-semibold text-clay-deep">
                  {(step.assignee?.name ?? "?").slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-sm font-medium text-ink">
                    {step.task.name}
                  </span>
                  <span className="block text-xs text-ink/50">
                    {step.assignee?.name}
                    {step.dueAt ? ` · due ${formatDayIn(timezone, step.dueAt)}` : ""}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                    STATE_TONE[step.state] ?? STATE_TONE.TODO
                  )}
                >
                  {STATE_LABEL[step.state] ?? step.state}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass flex flex-col gap-3 rounded-2xl p-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-lg text-ink">Latest photos</h2>
          <Link
            href={`${portal}/projects/${projectId}/gallery`}
            className="text-xs font-medium text-clay-deep hover:underline"
          >
            Gallery
          </Link>
        </div>
        {photos.length === 0 ? (
          <p className="text-sm text-ink/50">No photos yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {photos.map((photo) => (
                <div key={photo.id} className="relative aspect-[4/3] overflow-hidden rounded-xl bg-clay-soft">
                  <Image
                    src={photo.imageUrl}
                    alt={photo.caption ?? photo.space.name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ))}
            </div>
            <p dir="auto" className="text-xs text-ink/50">
              Newest in {photos[0].space.name} · {formatDayIn(timezone, photos[0].createdAt)}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
