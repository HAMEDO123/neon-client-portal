import Link from "next/link";
import Image from "next/image";
import { Building2, Plus } from "lucide-react";
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
    // `wide-page`: the whole frame on a desktop (globals.css).
    <div className="wide-page flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-ink">Projects</h1>
          <p className="mt-1 text-sm text-ink/50">
            Add drawings, documents and photos. Anything you add goes onto the client&apos;s page straight away.
          </p>
        </div>
        <Link
          href="/employee/projects/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-xs font-semibold text-bg"
        >
          <Plus size={14} strokeWidth={2.5} />
          New
        </Link>
      </div>

      {projects.length === 0 ? (
        <EmptyState icon={Building2} title="No projects yet" description="Start one with New, or wait for the manager to add one." />
      ) : (
        // Cover cards, the project's own render on top (the Studio look,
        // 2026-11-18): a studio's projects are recognised by their pictures
        // long before their names. One column on a phone, three on a desk.
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/employee/projects/${project.id}`}
                className="glass flex h-full flex-col overflow-hidden rounded-2xl transition-shadow hover:shadow-lg"
              >
                <div className="relative aspect-[16/10] w-full bg-clay-soft">
                  {project.coverImageUrl ? (
                    <Image src={project.coverImageUrl} alt="" fill className="object-cover" unoptimized />
                  ) : (
                    <span className="flex h-full items-center justify-center text-clay">
                      <Building2 size={28} strokeWidth={1.5} />
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-1 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-base font-semibold text-ink" dir="auto">
                      {project.name}
                    </p>
                    <span
                      className={
                        project.publishState === "DRAFT"
                          ? "shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900"
                          : "shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900"
                      }
                    >
                      {project.publishState === "DRAFT" ? "Draft" : "Live"}
                    </span>
                  </div>
                  <p className="truncate text-sm text-ink/55" dir="auto">
                    {project.clientName}
                    {project.location ? ` · ${project.location}` : ""}
                  </p>
                  <p className="mt-auto pt-2 text-xs text-ink/45">
                    {project._count.drawings} drawings · {project._count.documents} documents ·{" "}
                    {project._count.spaces} {project._count.spaces === 1 ? "room" : "rooms"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
