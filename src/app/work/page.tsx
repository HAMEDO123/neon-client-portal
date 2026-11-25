import type { Metadata } from "next";
import { LanguageProvider } from "@/lib/client-i18n";
import { WorkIndex } from "@/components/portfolio/work";
import { portfolioContact, portfolioProjects } from "@/lib/portfolio-store";
import { whatsappLink } from "@/lib/portfolio";

// The studio's public portfolio (lib/portfolio.ts): no sign-in, the link is
// meant to be passed on. Kept out of search engines like the rest of the site.

export async function generateMetadata(): Promise<Metadata> {
  const projects = await portfolioProjects();
  const description = "Selected interior design projects by NEON, Amman.";
  return {
    title: "Our work",
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: "NEON — Our work",
      description,
      images: projects[0] ? [{ url: projects[0].cover }] : undefined,
    },
  };
}

export default async function WorkPage() {
  const [projects, number] = await Promise.all([portfolioProjects(), portfolioContact()]);
  return (
    <LanguageProvider>
      <WorkIndex projects={projects} whatsapp={whatsappLink(number, "Hello NEON, I saw your work and I'd like to talk about a project.")} />
    </LanguageProvider>
  );
}
