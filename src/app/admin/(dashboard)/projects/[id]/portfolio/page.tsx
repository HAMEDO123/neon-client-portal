import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PortfolioEditor } from "@/components/admin/portfolio-editor";
import { portfolioUrl } from "@/lib/portfolio-store";

// Which of this project's photos go on the public portfolio, and under what
// title (lib/portfolio.ts). The manager's alone: the tab is not in the team's
// portal (`only: "/admin"` in project-tabs.tsx).

export default async function ProjectPortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      portfolioShown: true,
      portfolioTitle: true,
      portfolioNote: true,
      portfolioCategory: true,
      portfolioPlace: true,
      portfolioCoverId: true,
      spaces: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          images: { orderBy: { order: "asc" }, select: { id: true, imageUrl: true, caption: true, inPortfolio: true } },
        },
      },
    },
  });
  if (!project) notFound();

  return (
    <PortfolioEditor
      // A new key after each save re-reads the saved values into the form.
      key={`${project.portfolioShown}-${project.portfolioTitle}-${project.portfolioCategory}-${project.portfolioPlace}-${project.portfolioCoverId}`}
      projectId={project.id}
      shown={project.portfolioShown}
      title={project.portfolioTitle ?? ""}
      note={project.portfolioNote ?? ""}
      category={project.portfolioCategory ?? ""}
      place={project.portfolioPlace ?? ""}
      coverId={project.portfolioCoverId}
      rooms={project.spaces}
      publicUrl={`${portfolioUrl()}/${project.id}`}
    />
  );
}
