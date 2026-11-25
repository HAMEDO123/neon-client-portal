import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LanguageProvider } from "@/lib/client-i18n";
import { WorkProject } from "@/components/portfolio/work";
import { portfolioContact, portfolioProject, portfolioProjects } from "@/lib/portfolio-store";
import { whatsappLink } from "@/lib/portfolio";

// One project on the public portfolio. A project taken off the portfolio is a
// 404 here too, so an old link shows nothing the manager has withdrawn.

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const project = await portfolioProject(id);
  if (!project) return { title: "Our work", robots: { index: false, follow: false } };
  const description = project.note ?? "Interior design by NEON, Amman.";
  return {
    title: project.title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title: `${project.title} — NEON`, description, images: [{ url: project.cover }] },
  };
}

export default async function WorkProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [all, number] = await Promise.all([portfolioProjects(), portfolioContact()]);
  const at = all.findIndex((project) => project.id === id);
  if (at < 0) notFound();

  const project = all[at];
  const after = all.length > 1 ? all[(at + 1) % all.length] : null;
  return (
    <LanguageProvider>
      <WorkProject
        project={project}
        number={at + 1}
        total={all.length}
        next={after ? { id: after.id, title: after.title, cover: after.cover } : null}
        whatsapp={whatsappLink(number, `Hello NEON, I saw "${project.title}" and I'd like to talk about a project.`)}
      />
    </LanguageProvider>
  );
}
