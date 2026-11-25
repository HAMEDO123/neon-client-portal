"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowLeft, ArrowUpRight, MessageCircle } from "lucide-react";
import { Lightbox } from "@/components/client/lightbox";
import { WatermarkOverlay } from "@/components/client/watermark-overlay";
import { useI18n } from "@/lib/client-i18n";
import {
  categoriesIn,
  categoryLabel,
  PORTFOLIO_PATH,
  wideAt,
  type PortfolioCategory,
  type PortfolioProject,
} from "@/lib/portfolio";

// The public portfolio's two pages (lib/portfolio.ts), drawn as a studio's
// portfolio rather than as the client's page: one neutral palette of its own
// whatever colourway the platform wears, square images, numbered projects,
// a filter by kind of project, and the photos of a project laid out in rows of
// one wide and two side by side. English and Arabic through the client page's
// dictionary (lib/client-i18n.tsx).

const pad = (n: number) => String(n).padStart(2, "0");
const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.3em] rtl:tracking-normal";
const FRAME = "mx-auto w-full max-w-[1400px] px-5 sm:px-10";
const SERIF = "var(--font-display), var(--font-arabic), Georgia, serif";

function Header({ over, whatsapp }: { over: boolean; whatsapp: string | null }) {
  const { t, lang, setLang } = useI18n();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const solid = !over || scrolled;
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 transition-colors duration-500 ${
        solid ? "border-b border-[#e3ded6] bg-[#f5f3ef]/90 text-[#171614] backdrop-blur-md" : "border-b border-transparent text-white"
      }`}
    >
      <div className={`${FRAME} flex h-16 items-center justify-between sm:h-20`}>
        <Link href={PORTFOLIO_PATH} className="leading-none">
          <span className="block font-display text-xl font-semibold tracking-wide sm:text-2xl">NEON</span>
          <span className={`mt-1 block text-[9px] font-semibold uppercase tracking-[0.32em] ${solid ? "text-[#6f6a63]" : "text-white/70"}`}>
            Interior Design
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-[13px] font-medium sm:gap-2">
          <Link href={`${PORTFOLIO_PATH}#projects`} className="hidden px-3 py-2 opacity-80 transition-opacity hover:opacity-100 sm:block">
            {t("Projects")}
          </Link>
          <button
            type="button"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            className="px-3 py-2 opacity-80 transition-opacity hover:opacity-100"
            aria-label="Switch language"
          >
            {lang === "ar" ? "EN" : "عربي"}
          </button>
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noreferrer"
              className={`ms-1 rounded-full px-4 py-2 transition-colors ${
                solid ? "bg-[#171614] text-white hover:bg-black" : "bg-white text-[#171614] hover:bg-white/90"
              }`}
            >
              {t("Contact us")}
            </a>
          )}
        </nav>
      </div>
    </header>
  );
}

function Hero({ projects }: { projects: PortfolioProject[] }) {
  const { t } = useI18n();
  const still = useReducedMotion();
  const slides = projects.slice(0, 5);
  const [at, setAt] = useState(0);

  useEffect(() => {
    if (still || slides.length < 2) return;
    const timer = setInterval(() => setAt((current) => (current + 1) % slides.length), 6000);
    return () => clearInterval(timer);
  }, [still, slides.length]);

  const current = slides[at];
  return (
    <section className="relative h-[100svh] min-h-[560px] overflow-hidden bg-[#141311]">
      <AnimatePresence initial={false}>
        <motion.div
          key={current.id}
          initial={{ opacity: 0, scale: still ? 1 : 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ opacity: { duration: 1.4 }, scale: { duration: 7, ease: "linear" } }}
          className="absolute inset-0"
        >
          <Image src={current.cover} alt={current.title} fill priority unoptimized className="object-cover" />
        </motion.div>
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-black/45" />

      <div className={`${FRAME} relative z-10 flex h-full flex-col justify-end pb-8 sm:pb-12`}>
        <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className={`${EYEBROW} text-white/70`}>
          {t("Interior design studio · Amman")}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.1 }}
          className="mt-4 max-w-4xl font-display text-[2.7rem] font-medium leading-[1.03] text-white sm:text-7xl lg:text-[5.5rem]"
        >
          {t("Spaces designed with intent.")}
        </motion.h1>

        <div className="mt-10 border-t border-white/20 pt-5 text-white sm:mt-14">
          <div className="flex items-end justify-between gap-6">
            <Link href={`${PORTFOLIO_PATH}/${current.id}`} className="group min-w-0">
              <span className="block text-[11px] uppercase tracking-[0.25em] rtl:tracking-normal text-white/55">
                {t("Featured")} · <span dir="ltr">{pad(at + 1)} / {pad(slides.length)}</span>
              </span>
              <span className="mt-1.5 flex items-center gap-2 font-display text-lg sm:text-2xl">
                <span dir="auto" className="truncate">
                  {current.title}
                </span>
                <ArrowUpRight size={18} className="shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 rtl:-scale-x-100" />
              </span>
            </Link>
            <a href="#projects" className="hidden shrink-0 items-center gap-2 text-[11px] uppercase tracking-[0.25em] rtl:tracking-normal text-white/70 hover:text-white sm:flex">
              {t("Explore the work")}
              <ArrowDown size={14} />
            </a>
          </div>
          {slides.length > 1 && (
            <div className="mt-5 flex gap-1.5">
              {slides.map((slide, index) => (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => setAt(index)}
                  aria-label={slide.title}
                  className="group h-5 flex-1"
                >
                  <span className={`block h-[2px] w-full transition-colors duration-500 ${index === at ? "bg-white" : "bg-white/25 group-hover:bg-white/50"}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Intro({ projects }: { projects: PortfolioProject[] }) {
  const { t } = useI18n();
  const images = projects.reduce((total, project) => total + project.photoCount, 0);
  const facts = [
    { value: pad(projects.length), label: t("Selected projects") },
    { value: String(images), label: t("Images") },
    { value: t("Amman"), label: t("Based in") },
  ];
  return (
    <section className={`${FRAME} grid gap-12 py-20 sm:py-28 lg:grid-cols-12`}>
      <div className="lg:col-span-7">
        <p className={`${EYEBROW} text-[#8a7f72]`}>{t("The studio")}</p>
        <p className="mt-6 font-display text-[1.7rem] leading-[1.3] text-[#171614] sm:text-[2.4rem] sm:leading-[1.25]">
          {t("We design homes, cafés and workplaces that feel as good as they look — from the first sketch to the last detail.")}
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-4 self-end lg:col-span-4 lg:col-start-9 lg:grid-cols-1 lg:gap-0">
        {facts.map((fact) => (
          <div key={fact.label} className="border-t border-[#d9d3c9] pt-4 lg:flex lg:items-baseline lg:justify-between lg:py-5">
            <dt className="order-2 text-[12px] text-[#6f6a63]">{fact.label}</dt>
            <dd dir="auto" className="mt-1 font-display text-2xl text-[#171614] sm:text-3xl lg:mt-0">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Card({ project, number }: { project: PortfolioProject; number: number }) {
  const { t } = useI18n();
  const category = categoryLabel(project.category);
  const where = [project.place, project.area].filter(Boolean);
  return (
    <Link href={`${PORTFOLIO_PATH}/${project.id}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden bg-[#e9e5de]">
        <Image
          src={project.cover}
          alt={project.title}
          fill
          unoptimized
          className="object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.05]"
        />
        {project.watermark && <WatermarkOverlay />}
        <div className="absolute inset-0 bg-black/0 transition-colors duration-500 group-hover:bg-black/20" />
        <span className="absolute bottom-4 start-4 flex translate-y-2 items-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-medium text-[#171614] opacity-0 transition duration-500 group-hover:translate-y-0 group-hover:opacity-100">
          {t("View project")}
          <ArrowUpRight size={14} className="rtl:-scale-x-100" />
        </span>
      </div>
      <div className="mt-4 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] rtl:tracking-normal text-[#8a7f72]">
        <span dir="ltr" className="tabular-nums">
          {pad(number)}
        </span>
        {category && (
          <>
            <span className="h-px w-6 bg-[#cfc8bd]" />
            <span>{t(category)}</span>
          </>
        )}
      </div>
      {/* globals.css sets every h3 in the sans, outside any layer, so the class alone loses. */}
      <h3 dir="auto" style={{ fontFamily: SERIF }} className="mt-2 text-[1.6rem] font-medium leading-tight text-[#171614]">
        {project.title}
      </h3>
      {where.length > 0 && (
        <p dir="auto" className="mt-1.5 text-sm text-[#6f6a63]">
          {where.join(" · ")}
        </p>
      )}
    </Link>
  );
}

function Projects({ projects }: { projects: PortfolioProject[] }) {
  const { t } = useI18n();
  const categories = categoriesIn(projects);
  const [filter, setFilter] = useState<PortfolioCategory | "all">("all");
  const shown = filter === "all" ? projects : projects.filter((project) => project.category === filter);
  const buttons: { value: PortfolioCategory | "all"; label: string; count: number }[] = [
    { value: "all", label: "All", count: projects.length },
    ...categories.map((category) => ({
      value: category.value,
      label: category.label,
      count: projects.filter((project) => project.category === category.value).length,
    })),
  ];

  return (
    <section id="projects" className={`${FRAME} scroll-mt-20 pb-28`}>
      <div className="flex flex-col gap-6 border-t border-[#d9d3c9] pt-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={`${EYEBROW} text-[#8a7f72]`}>{t("Selected work")}</p>
          <h2 className="mt-3 font-display text-4xl text-[#171614] sm:text-5xl">{t("Projects")}</h2>
        </div>
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {buttons.map((button) => {
              const active = filter === button.value;
              return (
                <button
                  key={button.value}
                  type="button"
                  onClick={() => setFilter(button.value)}
                  className={`rounded-full border px-4 py-2 text-[13px] transition-colors ${
                    active ? "border-[#171614] bg-[#171614] text-white" : "border-[#d9d3c9] text-[#171614]/75 hover:border-[#171614] hover:text-[#171614]"
                  }`}
                >
                  {t(button.label)}
                  <span className="ms-1.5 opacity-50">{button.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {projects.length === 0 ? (
        <p className="py-24 text-center text-[#6f6a63]">{t("New projects are coming soon.")}</p>
      ) : (
        <motion.div layout className="mt-12 grid grid-cols-1 gap-x-6 gap-y-16 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {shown.map((project) => (
              <motion.div
                key={project.id}
                layout
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <Card project={project} number={projects.indexOf(project) + 1} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </section>
  );
}

function Contact({ whatsapp }: { whatsapp: string | null }) {
  const { t } = useI18n();
  return (
    <section id="contact" className="bg-[#141311] text-white">
      <div className={`${FRAME} py-24 sm:py-32`}>
        <p className={`${EYEBROW} text-white/45`}>{t("Start a project")}</p>
        <h2 className="mt-5 max-w-3xl font-display text-[2.6rem] leading-[1.05] sm:text-6xl">{t("Let's design your space.")}</h2>
        <p className="mt-6 max-w-lg text-white/60">{t("Tell us about your place and what you have in mind.")}</p>
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noreferrer"
            className="mt-10 inline-flex items-center gap-3 rounded-full bg-white px-7 py-4 text-sm font-semibold text-[#141311] transition-transform hover:scale-[1.02]"
          >
            <MessageCircle size={18} />
            {t("Message us on WhatsApp")}
          </a>
        )}
        <div className="mt-20 flex flex-wrap justify-between gap-4 border-t border-white/15 pt-6 text-[12px] text-white/45">
          <span>NEON Interior Design</span>
          <span>{t("Amman, Jordan")}</span>
        </div>
      </div>
    </section>
  );
}

export function WorkIndex({ projects, whatsapp }: { projects: PortfolioProject[]; whatsapp: string | null }) {
  return (
    <main className="min-h-screen bg-[#f5f3ef] text-[#171614]">
      <Header over={projects.length > 0} whatsapp={whatsapp} />
      {projects.length > 0 ? <Hero projects={projects} /> : <div className="h-24" />}
      {projects.length > 0 && <Intro projects={projects} />}
      <Projects projects={projects} />
      <Contact whatsapp={whatsapp} />
    </main>
  );
}

export function WorkProject({
  project,
  number,
  total,
  next,
  whatsapp,
}: {
  project: PortfolioProject;
  number: number;
  total: number;
  next: { id: string; title: string; cover: string } | null;
  whatsapp: string | null;
}) {
  const { t } = useI18n();
  const still = useReducedMotion();
  const [open, setOpen] = useState<number | null>(null);
  const photos = project.photos;
  const wide = wideAt(photos.length);
  const category = categoryLabel(project.category);
  const details = [
    { label: "Category", value: category ? t(category) : null },
    { label: "Location", value: project.place },
    { label: "Area", value: project.area },
    { label: "Images", value: String(project.photoCount) },
  ].filter((detail) => detail.value);

  return (
    <main className="min-h-screen bg-[#f5f3ef] text-[#171614]">
      <Header over whatsapp={whatsapp} />

      <section className="relative h-[88svh] min-h-[520px] overflow-hidden bg-[#141311]">
        <motion.div
          initial={{ scale: still ? 1 : 1.08 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2.4, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0"
        >
          <Image src={project.cover} alt={project.title} fill priority unoptimized className="object-cover" />
        </motion.div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/45" />
        {project.watermark && <WatermarkOverlay />}

        <div className={`${FRAME} relative z-10 flex h-full flex-col justify-end pb-10 sm:pb-16`}>
          <Link href={`${PORTFOLIO_PATH}#projects`} className="mb-8 inline-flex items-center gap-2 self-start text-[12px] text-white/70 hover:text-white">
            <ArrowLeft size={14} className="rtl:rotate-180" />
            {t("All projects")}
          </Link>
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }} className={`${EYEBROW} text-white/65`}>
            <span dir="ltr">
              {pad(number)} / {pad(total)}
            </span>
            {category && <> · {t(category)}</>}
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.1 }}
            dir="auto"
            className="mt-4 max-w-4xl font-display text-[2.6rem] font-medium leading-[1.04] text-white sm:text-7xl"
          >
            {project.title}
          </motion.h1>
        </div>
      </section>

      <section className={`${FRAME} grid gap-12 py-16 sm:py-24 lg:grid-cols-12`}>
        <div className="lg:col-span-7">
          <p className={`${EYEBROW} text-[#8a7f72]`}>{t("About the project")}</p>
          <p dir="auto" className="mt-6 font-display text-[1.55rem] leading-[1.4] text-[#171614] sm:text-[2rem] sm:leading-[1.35]">
            {project.note ?? t("A NEON interior, from the first idea to the last detail.")}
          </p>
        </div>
        <dl className="self-end border-t border-[#d9d3c9] lg:col-span-4 lg:col-start-9">
          {details.map((detail) => (
            <div key={detail.label} className="flex items-baseline justify-between gap-6 border-b border-[#d9d3c9] py-4 text-sm">
              <dt className="text-[#6f6a63]">{t(detail.label)}</dt>
              <dd dir="auto" className="text-end font-medium text-[#171614]">
                {detail.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={FRAME}>
        <div className="grid grid-cols-2 gap-3 sm:gap-5">
          {photos.map((photo, index) => (
            <motion.button
              key={photo.id}
              type="button"
              onClick={() => setOpen(index)}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className={`group relative overflow-hidden bg-[#e9e5de] ${wide[index] ? "col-span-2 aspect-[16/10] sm:aspect-[16/9]" : "aspect-[4/5] sm:aspect-[4/3]"}`}
            >
              <Image
                src={photo.url}
                alt={photo.caption ?? project.title}
                fill
                unoptimized
                className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03]"
              />
              {project.watermark && <WatermarkOverlay />}
            </motion.button>
          ))}
        </div>
      </section>

      <Lightbox
        images={photos.map((photo) => ({ url: photo.url, caption: photo.caption }))}
        index={open}
        onClose={() => setOpen(null)}
        onNavigate={setOpen}
        watermark={project.watermark}
      />

      {next && (
        <section className={`${FRAME} pb-28 pt-28`}>
          <Link href={`${PORTFOLIO_PATH}/${next.id}`} className="group block">
            <div className="flex items-end justify-between gap-6 border-t border-[#d9d3c9] pt-6">
              <div className="min-w-0">
                <p className={`${EYEBROW} text-[#8a7f72]`}>{t("Next project")}</p>
                <p dir="auto" className="mt-3 truncate font-display text-3xl text-[#171614] sm:text-5xl">
                  {next.title}
                </p>
              </div>
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#171614] transition-colors group-hover:bg-[#171614] group-hover:text-white">
                <ArrowUpRight size={20} className="rtl:-scale-x-100" />
              </span>
            </div>
            <div className="relative mt-8 aspect-[16/9] overflow-hidden bg-[#e9e5de] sm:aspect-[21/8]">
              <Image src={next.cover} alt={next.title} fill unoptimized className="object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-[1.04]" />
            </div>
          </Link>
        </section>
      )}

      <Contact whatsapp={whatsapp} />
    </main>
  );
}
