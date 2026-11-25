import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowUp, EyeOff, Pencil } from "lucide-react";
import { prisma } from "@/lib/db";
import { portfolioContact, portfolioUrl } from "@/lib/portfolio-store";
import { hideFromPortfolio, movePortfolio } from "@/lib/actions/portfolio-actions";
import { PortfolioLink } from "@/components/admin/portfolio-link";

// The public portfolio as the manager runs it (lib/portfolio.ts): the link,
// the projects on it in their order, and the projects with photos that are not.
// Which photos a project shows is chosen on that project's Portfolio tab.

export const metadata = { title: "Portfolio" };

export default async function PortfolioAdminPage() {
  const [projects, whatsapp] = await Promise.all([
    prisma.project.findMany({
      where: { publishState: { not: "ARCHIVED" } },
      orderBy: [{ portfolioOrder: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        portfolioShown: true,
        portfolioTitle: true,
        portfolioCoverId: true,
        coverImageUrl: true,
        spaces: { select: { images: { orderBy: { order: "asc" }, select: { id: true, imageUrl: true, inPortfolio: true } } } },
      },
    }),
    portfolioContact(),
  ]);

  const rows = projects.map((project) => {
    const images = project.spaces.flatMap((space) => space.images);
    const picked = images.filter((image) => image.inPortfolio);
    const cover = picked.find((image) => image.id === project.portfolioCoverId) ?? picked[0];
    return {
      ...project,
      total: images.length,
      picked: picked.length,
      thumb: cover?.imageUrl ?? project.coverImageUrl ?? images[0]?.imageUrl ?? null,
    };
  });
  const shown = rows.filter((row) => row.portfolioShown);
  const others = rows.filter((row) => !row.portfolioShown && row.total > 0);
  const url = portfolioUrl();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Portfolio</h1>
        <p className="mt-1 text-sm text-ink/55">
          A public page of the work you choose, to send to people thinking of hiring NEON. A project goes on it by itself the first
          time it is published. Clients&apos; names, phones and prices never appear on it.
        </p>
      </div>

      <PortfolioLink url={url} whatsapp={whatsapp} />

      <section className="glass rounded-2xl p-6">
        <h3 className="text-base font-semibold text-ink">On the portfolio ({shown.length})</h3>
        {shown.length === 0 ? (
          <p className="mt-2 text-sm text-ink/55">Nothing yet. Open a project below, tick its best photos and show it.</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {shown.map((row, index) => (
              <li key={row.id} className="flex items-center gap-3 rounded-xl border border-ink/8 bg-white/60 p-2">
                <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-ink/5">
                  {row.thumb && <Image src={row.thumb} alt="" fill unoptimized className="object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{row.portfolioTitle || "(no title)"}</div>
                  <div className="truncate text-xs text-ink/50">
                    {row.name} · {row.picked} photo{row.picked === 1 ? "" : "s"}
                    {row.picked === 0 && " — chosen for you"}
                  </div>
                </div>
                <form className="flex items-center gap-1">
                  <button
                    formAction={movePortfolio.bind(null, row.id, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                    className="rounded-full p-2 text-ink/60 hover:bg-ink/5 disabled:opacity-25"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    formAction={movePortfolio.bind(null, row.id, 1)}
                    disabled={index === shown.length - 1}
                    aria-label="Move down"
                    className="rounded-full p-2 text-ink/60 hover:bg-ink/5 disabled:opacity-25"
                  >
                    <ArrowDown size={16} />
                  </button>
                  <Link href={`/admin/projects/${row.id}/portfolio`} aria-label="Choose photos" className="rounded-full p-2 text-ink/60 hover:bg-ink/5">
                    <Pencil size={16} />
                  </Link>
                  <button
                    formAction={hideFromPortfolio.bind(null, row.id)}
                    aria-label="Take off the portfolio"
                    title="Take off the portfolio"
                    className="rounded-full p-2 text-ink/60 hover:bg-ink/5"
                  >
                    <EyeOff size={16} />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {others.length > 0 && (
        <section className="glass rounded-2xl p-6">
          <h3 className="text-base font-semibold text-ink">Projects you could add</h3>
          <p className="mt-0.5 text-sm text-ink/55">Open one to pick its photos and give it a title.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {others.map((row) => (
              <Link
                key={row.id}
                href={`/admin/projects/${row.id}/portfolio`}
                className="group overflow-hidden rounded-xl border border-ink/8 bg-white/60"
              >
                <div className="relative aspect-[4/3] bg-ink/5">
                  {row.thumb && (
                    <Image src={row.thumb} alt="" fill unoptimized className="object-cover transition-transform group-hover:scale-105" />
                  )}
                </div>
                <div className="p-2.5">
                  <div className="truncate text-sm font-semibold text-ink">{row.name}</div>
                  <div className="text-xs text-ink/50">{row.total} photos</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
