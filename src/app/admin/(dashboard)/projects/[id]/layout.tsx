import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getProjectById } from "@/lib/queries";
import { ProjectTabs } from "@/components/admin/project-tabs";
import { LinkActions } from "@/components/admin/link-actions";
import { ensureAccessCode } from "@/lib/client-access";
import { isWhatsAppAvailable } from "@/lib/whatsapp";
import { PublishControls } from "@/components/admin/publish-controls";
import { ProjectHero } from "@/components/admin/project-hero";

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
      {/* The project as the studio recognises it: its render, its name, where
          it is along the stages (the new UI, 2026-11-18). */}
      <ProjectHero project={project} />

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        <PublishControls projectId={project.id} publishState={project.publishState} />
      </div>

      <div className="mt-4">
        <LinkActions
          canSendDirect={isWhatsAppAvailable()}
          projectId={project.id}
          token={project.token}
          accessCode={await ensureAccessCode(project.id)}
          clientName={project.clientName}
          clientPhone={project.clientPhone}
        />
      </div>

      <ProjectTabs projectId={project.id} className="mt-8" />

      <div className="mt-6">{children}</div>
    </div>
  );
}
