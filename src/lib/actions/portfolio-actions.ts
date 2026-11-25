"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-guard";
import { setSetting } from "@/lib/settings";
import { refreshProject } from "@/lib/project-paths";
import { categoryOf, moved, PORTFOLIO_CONTACT_KEY, PORTFOLIO_PATH } from "@/lib/portfolio";

// The manager's choices for the public portfolio (lib/portfolio.ts). Each
// answers in a sentence rather than throwing one, because a thrown message
// never reaches the page in production.

export type PortfolioResult = { ok: boolean; message: string } | null;

function refresh(projectId?: string) {
  revalidatePath(PORTFOLIO_PATH, "layout");
  revalidatePath("/admin/portfolio");
  if (projectId) refreshProject(projectId, { tab: "portfolio" });
}

const text = (form: FormData, name: string, most: number) => String(form.get(name) ?? "").trim().slice(0, most);

/** One project's place on the portfolio: shown or not, its public title and words, its photos and cover. */
export async function savePortfolio(projectId: string, _before: PortfolioResult, form: FormData): Promise<PortfolioResult> {
  try {
    await requireAdmin();
  } catch (cause) {
    return { ok: false, message: cause instanceof Error && cause.message === "Locked" ? "Editing is locked. Unlock it and save again." : "Sign in again to save." };
  }

  const shown = form.get("shown") === "on";
  const title = text(form, "title", 120);
  const note = text(form, "note", 1000);
  const place = text(form, "place", 80);
  const category = categoryOf(String(form.get("category") ?? ""));
  const picked = [...new Set(form.getAll("photo").map(String))];
  const cover = String(form.get("cover") ?? "") || null;

  if (shown && !title) return { ok: false, message: "Write the title clients will see before showing it." };

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { portfolioShown: true, portfolioAddedAt: true } });
  if (!project) return { ok: false, message: "That project is gone." };

  // A newly shown project goes to the end of the list.
  let order: number | undefined;
  if (shown && !project.portfolioShown) {
    const last = await prisma.project.aggregate({ where: { portfolioShown: true }, _max: { portfolioOrder: true } });
    order = (last._max.portfolioOrder ?? -1) + 1;
  }

  // Only this project's photos can be ticked, whatever ids the form carried.
  const mine = { space: { projectId } };
  await prisma.$transaction([
    prisma.galleryImage.updateMany({ where: { ...mine, inPortfolio: true, id: { notIn: picked } }, data: { inPortfolio: false } }),
    prisma.galleryImage.updateMany({ where: { ...mine, id: { in: picked } }, data: { inPortfolio: true } }),
    prisma.project.update({
      where: { id: projectId },
      data: {
        portfolioShown: shown,
        portfolioTitle: title || null,
        portfolioNote: note || null,
        portfolioPlace: place || null,
        portfolioCategory: category,
        portfolioCoverId: cover && picked.includes(cover) ? cover : null,
        ...(order === undefined ? {} : { portfolioOrder: order }),
        // Shown by hand counts as added: publishing it later changes nothing.
        ...(shown && !project.portfolioAddedAt ? { portfolioAddedAt: new Date() } : {}),
      },
    }),
  ]);

  refresh(projectId);
  return {
    ok: true,
    message: !shown
      ? "Saved. It isn't on the portfolio."
      : picked.length === 0
        ? "Saved. It's on the portfolio, with photos chosen for you."
        : `Saved. It's on the portfolio with ${picked.length} photo${picked.length === 1 ? "" : "s"}.`,
  };
}

/** Move a shown project one place up or down the portfolio. */
export async function movePortfolio(projectId: string, direction: -1 | 1) {
  await requireAdmin();
  const shown = await prisma.project.findMany({
    where: { portfolioShown: true },
    orderBy: [{ portfolioOrder: "asc" }, { updatedAt: "desc" }],
    select: { id: true },
  });
  const next = moved(shown.map((row) => row.id), projectId, direction === -1 ? -1 : 1);
  await prisma.$transaction(next.map((id, index) => prisma.project.update({ where: { id }, data: { portfolioOrder: index } })));
  refresh();
}

/** Take a project off the portfolio, keeping its title and photos for next time. */
export async function hideFromPortfolio(projectId: string) {
  await requireAdmin();
  await prisma.project.update({ where: { id: projectId }, data: { portfolioShown: false } });
  refresh(projectId);
}

/** The studio's WhatsApp number for the portfolio's "talk to us" button. */
export async function savePortfolioContact(_before: PortfolioResult, form: FormData): Promise<PortfolioResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, message: "Unlock editing and save again." };
  }
  const number = text(form, "whatsapp", 30);
  await setSetting(PORTFOLIO_CONTACT_KEY, number);
  refresh();
  return { ok: true, message: number ? "Saved." : "Saved. The portfolio has no WhatsApp button now." };
}
