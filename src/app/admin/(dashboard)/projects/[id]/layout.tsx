import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getProjectById } from "@/lib/queries";
import { ProjectTabs } from "@/components/admin/project-tabs";
import { LinkActions } from "@/components/admin/link-actions";
import { PublishControls } from "@/components/admin/publish-controls";
import { Badge } from "@/components/ui/badge";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-ink">{project.name}</h1>
            <Badge tone={project.publishState === "PUBLISHED" ? "success" : "warning"}>{project.publishState}</Badge>
          </div>
          <p className="mt-1 text-sm text-ink/50">{project.clientName}</p>
        </div>
        <PublishControls projectId={project.id} publishState={project.publishState} />
      </div>

      <div className="mt-4">
        <LinkActions projectId={project.id} token={project.token} clientName={project.clientName} />
      </div>

      <ProjectTabs projectId={project.id} className="mt-8" />

      <div className="mt-6">{children}</div>
    </div>
  );
}
