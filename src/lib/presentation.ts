import type { FullProject } from "@/lib/queries";
import type { Slide } from "@/components/client/presentation-mode";
import { formatCurrency } from "@/lib/format";

export function buildPresentationSlides(project: FullProject): Slide[] {
  const slides: Slide[] = [
    {
      kind: "cover",
      eyebrow: "NEON",
      title: project.name,
      subtitle: [project.projectType, project.location].filter(Boolean).join(" · ") || undefined,
      image: project.coverImageUrl,
    },
  ];

  if (project.description) {
    slides.push({ kind: "text", title: "The Concept", body: project.description });
  }

  for (const space of project.spaces) {
    const hero = space.images[0];
    if (hero) {
      slides.push({ kind: "image", title: space.name, subtitle: hero.caption ?? undefined, image: hero.imageUrl });
    }
  }

  if (project.materials.length > 0) {
    slides.push({
      kind: "grid",
      title: "Materials & Finishes",
      items: project.materials.map((m) => ({ image: m.imageUrl, label: m.name, sub: m.category })),
    });
  }

  if (project.furniture.length > 0) {
    slides.push({
      kind: "grid",
      title: "Furniture & Products",
      items: project.furniture.map((f) => ({ image: f.imageUrl, label: f.name, sub: f.brand ?? undefined })),
    });
  }

  if (project.drawings.length > 0) {
    slides.push({
      kind: "stat",
      title: "Technical Drawings Delivered",
      value: String(project.drawings.length),
      sub: Array.from(new Set(project.drawings.map((d) => d.category))).join(" · "),
    });
  }

  if (project.boqItems.length > 0) {
    slides.push({
      kind: "stat",
      title: "Bill of Quantities",
      value: String(project.boqItems.length),
      sub: "line items specified and ready for execution",
    });
  }

  if (project.showPricing && project.pricingItems.length > 0) {
    const total = project.pricingItems.filter((p) => !p.isOptional).reduce((sum, p) => sum + p.amount, 0);
    slides.push({ kind: "stat", title: "Total Project Investment", value: formatCurrency(total) });
  }

  slides.push({
    kind: "cta",
    title: "Ready to move forward?",
    subtitle: "Review every detail and let NEON know when you're ready to approve.",
    ctaLabel: "Go to Approvals",
    ctaHref: "#approvals",
  });

  return slides;
}
