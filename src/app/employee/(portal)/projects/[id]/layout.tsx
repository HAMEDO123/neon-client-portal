import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { requireEmployee } from "@/lib/employee-session";
import { ProjectTabs } from "@/components/admin/project-tabs";
import { LinkActions } from "@/components/admin/link-actions";
import { isWhatsAppAvailable } from "@/lib/whatsapp";
import { PublishControls } from "@/components/admin/publish-controls";
import { Badge } from "@/components/ui/badge";

// A project, from the team's side — the manager's own screen, in their portal.
//
// The studio decided the team works a project exactly as the manager does, so
// these are the same modules rather than a second set: one implementation to
// keep in step, and no chance of the two drifting apart. What differs is only
// where the tabs point, which is why ProjectTabs takes a portal.
//
// The portal's layout has already checked the session, and this checks it
// again, because every surface in this codebase checks for itself.
export default async function EmployeeProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  await requireEmployee();

  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div>
      <Link
        href="/employee/projects"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-ink/45 hover:text-ink"
      >
        <ArrowLeft size={15} strokeWidth={2} />
        Projects
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">{project.name}</h1>
            <Badge tone={project.publishState === "PUBLISHED" ? "success" : "warning"}>{project.publishState}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink/50">{project.clientName}</p>
        </div>
        <PublishControls projectId={project.id} publishState={project.publishState} />
      </div>

      {/* Said plainly, on the screen where the editing happens: this is
          publishing, not saving. It was on the old employee project page and it
          belongs here for the same reason — the client sees this immediately. */}
      <p className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        {project.publishState === "PUBLISHED"
          ? "This project is live. Anything you add or remove here changes the client’s page straight away."
          : "This project is not published, so the client sees nothing until somebody publishes it."}
      </p>

      <div className="mt-4">
        <LinkActions
          canSendDirect={isWhatsAppAvailable()}
          projectId={project.id}
          token={project.token}
          clientName={project.clientName}
          clientPhone={project.clientPhone}
        />
      </div>

      <ProjectTabs projectId={project.id} portal="/employee" className="mt-6" />

      <div className="mt-6">{children}</div>
    </div>
  );
}
