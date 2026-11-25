import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { firstGuess, PORTFOLIO_CONTACT_KEY, PORTFOLIO_PATH, toPortfolioProject, type PortfolioProject } from "@/lib/portfolio";

// The portfolio's reads, and adding a project to it when it is published
// (lib/portfolio.ts says what it is).
//
// **Every field is named.** A project row carries the client's name, phone and
// email and the token that opens their private page; an `include` here would
// put all of that into the public page's server render, one careless prop away
// from the browser. tests/portfolio.test.ts holds this file to it.

const PUBLIC_FIELDS = {
  id: true,
  portfolioTitle: true,
  portfolioNote: true,
  portfolioCoverId: true,
  portfolioCategory: true,
  portfolioPlace: true,
  projectType: true,
  area: true,
  watermarkEnabled: true,
  spaces: {
    orderBy: { order: "asc" },
    // The images only: a room's name is the studio's label, not the public's.
    select: {
      // Every photo, so that with none ticked the portfolio can choose (autoPick).
      images: {
        orderBy: { order: "asc" },
        select: { id: true, imageUrl: true, caption: true, inPortfolio: true },
      },
    },
  },
} as const;

/** Every shown project with something to show, in the manager's order. */
export async function portfolioProjects(): Promise<PortfolioProject[]> {
  const rows = await prisma.project.findMany({
    where: { portfolioShown: true },
    orderBy: [{ portfolioOrder: "asc" }, { updatedAt: "desc" }],
    select: PUBLIC_FIELDS,
  });
  return rows.map(toPortfolioProject).filter((project): project is PortfolioProject => project !== null);
}

/** One shown project, or null — a project taken off the portfolio is gone from its link too. */
export async function portfolioProject(id: string): Promise<PortfolioProject | null> {
  const row = await prisma.project.findFirst({ where: { id, portfolioShown: true }, select: PUBLIC_FIELDS });
  return row ? toPortfolioProject(row) : null;
}

/**
 * Put a project that has just been published on the portfolio — once. A
 * project already added (portfolioAddedAt), by hand or by an earlier publish,
 * is left exactly as it is, so one the manager took off stays off. Anything the
 * manager already wrote is kept; the rest is `firstGuess`. Returns whether it
 * was added.
 */
export async function addOnPublish(projectId: string, now = new Date()) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      portfolioAddedAt: true,
      portfolioTitle: true,
      portfolioCategory: true,
      portfolioPlace: true,
      projectType: true,
      location: true,
      // Read to guess the kind of project from its words; never written to the portfolio (firstGuess).
      name: true,
    },
  });
  if (!project || project.portfolioAddedAt) return false;

  const guess = firstGuess(project);
  const last = await prisma.project.aggregate({ where: { portfolioShown: true }, _max: { portfolioOrder: true } });
  // Claimed in the WHERE, so two publishes at once add it once.
  const added = await prisma.project.updateMany({
    where: { id: projectId, portfolioAddedAt: null },
    data: {
      portfolioShown: true,
      portfolioAddedAt: now,
      portfolioOrder: (last._max.portfolioOrder ?? -1) + 1,
      portfolioTitle: project.portfolioTitle ?? guess.title,
      portfolioCategory: project.portfolioCategory ?? guess.category,
      portfolioPlace: project.portfolioPlace ?? guess.place,
    },
  });
  return added.count > 0;
}

export async function portfolioContact() {
  return (await getSetting(PORTFOLIO_CONTACT_KEY)) ?? "";
}

/** The address to send: this site's own, as PUBLIC_APP_URL gives it. */
export function portfolioUrl() {
  const base = (process.env.PUBLIC_APP_URL ?? "https://clients.neonjo.com").replace(/\/$/, "");
  return `${base}${PORTFOLIO_PATH}`;
}
