import Image from "next/image";
import { PROJECT_STAGES } from "@/lib/constants";
import { cn } from "@/lib/utils";

// The top of a project, the way the studio recognises one: its own render
// across the page with the name written over it, and where it has got to
// along the stages (the new UI, "everything by project", 2026-11-18).
//
// Shared by the manager's project screen and the team's, like everything else
// on those screens. Purely a picture of the project — the controls that change
// it (publish, the client link) sit under it, where they always were.

type HeroProject = {
  name: string;
  clientName: string;
  location: string | null;
  projectType: string | null;
  coverImageUrl: string | null;
  publishState: string;
  currentStage: string;
  completionPercent: number;
};

export function ProjectHero({ project }: { project: HeroProject }) {
  const stageIndex = Math.max(
    0,
    PROJECT_STAGES.findIndex((stage) => stage.value === project.currentStage)
  );
  const facts = [project.projectType, project.location, project.clientName].filter(Boolean).join(" · ");
  const live = project.publishState === "PUBLISHED";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative h-52 overflow-hidden rounded-3xl bg-clay-soft sm:h-60">
        {project.coverImageUrl ? (
          <Image src={project.coverImageUrl} alt="" fill className="object-cover" unoptimized priority />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-clay to-bark" />
        )}
        {/* Dark enough at the foot to write on, clear through the middle so the
            render is still the first thing seen. */}
        <div className="absolute inset-0 bg-gradient-to-t from-bark/85 via-bark/25 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-5 sm:p-7">
          <div className="min-w-0">
            {facts && (
              <p dir="auto" className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">
                {facts}
              </p>
            )}
            {/* The page's title, in white over the picture. */}
            <h1 dir="auto" className="project-hero-title mt-1 text-white">
              {project.name}
            </h1>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider",
              live ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"
            )}
          >
            {live ? "Live" : "Draft"}
          </span>
        </div>
      </div>

      {/* Where it is along the stages: done ones filled, the current one dark. */}
      <div aria-label={`Stage ${stageIndex + 1} of ${PROJECT_STAGES.length}: ${PROJECT_STAGES[stageIndex].label}`}>
        <div className="flex gap-1.5">
          {PROJECT_STAGES.map((stage, index) => (
            <div key={stage.value} className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span
                className={cn(
                  "h-1.5 rounded-full",
                  index < stageIndex ? "bg-clay" : index === stageIndex ? "bg-clay-deep" : "bg-ink/10"
                )}
              />
              <span
                className={cn(
                  "hidden truncate text-[11px] lg:block",
                  index === stageIndex ? "font-semibold text-ink" : "text-ink/45"
                )}
              >
                {stage.label}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink/55 lg:hidden">
          <span className="font-semibold text-ink">{PROJECT_STAGES[stageIndex].label}</span> · stage {stageIndex + 1} of{" "}
          {PROJECT_STAGES.length}
          {project.completionPercent > 0 ? ` · ${project.completionPercent}% complete` : ""}
        </p>
      </div>
    </div>
  );
}
