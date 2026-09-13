import Link from "next/link";
import Image from "next/image";
import { Building2, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { EmptyState } from "@/components/ui/empty-state";

// Every project the studio has open, for whoever is signed in.
//
// No filtering by who holds what: the studio chose that anybody on the team may
// add to any project. The page still runs behind `requireEmployee`, so it is
// the team, not the internet.

export default async function EmployeeProjectsPage() {
  await requireEmployee();

  const projects = await prisma.project.findMany({
    where: { publishState: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      clientName: true,
      location: true,
      coverImageUrl: true,
      publishState: true,
      _count: { select: { drawings: true, documents: true, spaces: true } },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">Projects</h1>
        <p className="mt-1 text-sm text-ink/50">
          Add drawings, documents and photos. Anything you add goes onto the client&apos;s page straight away.
        </p>
      </div>

      {projects.length === 0 ? (
        <EmptyState icon={Building2} title="No projects yet" description="The manager adds projects; they appear here." />
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/employee/projects/${project.id}`}
                className="glass flex items-center gap-3 rounded-2xl p-3 active:bg-white/60"
              >
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-ink/8 bg-ink/5">
                  {project.coverImageUrl ? (
                    <Image src={project.coverImageUrl} alt="" fill className="object-cover" unoptimized />
                  ) : (
                    <span className="flex h-full items-center justify-center text-ink/25">
                      <Building2 size={18} strokeWidth={1.75} />
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{project.name}</p>
                  <p className="truncate text-xs text-ink/45">
                    {project.clientName}
                    {project.location ? ` · ${project.location}` : ""}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink/35">
                    {project._count.drawings} drawings · {project._count.documents} documents ·{" "}
                    {project._count.spaces} {project._count.spaces === 1 ? "space" : "spaces"}
                    {project.publishState === "DRAFT" ? " · not published yet" : ""}
                  </p>
                </div>

                <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-ink/25" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
