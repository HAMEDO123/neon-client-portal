import type { Metadata } from "next";
import { getProjectByToken } from "@/lib/queries";
import { logActivity } from "@/lib/activity";
import { StickyNav, MobileNav, type NavItem } from "@/components/client/sticky-nav";
import { WelcomeOverlay } from "@/components/client/welcome-overlay";
import { Hero } from "@/components/client/hero";
import { OverviewSection } from "@/components/client/overview-section";
import { GallerySection } from "@/components/client/gallery-section";
import { DrawingsSection } from "@/components/client/drawings-section";
import { MaterialsSection } from "@/components/client/materials-section";
import { FurnitureSection } from "@/components/client/furniture-section";
import { BoqSection } from "@/components/client/boq-section";
import { PricingSection } from "@/components/client/pricing-section";
import { DocumentsSection } from "@/components/client/documents-section";
import { ApprovalsSection } from "@/components/client/approvals-section";
import { FeedbackSection } from "@/components/client/feedback-section";
import { HandoverSection } from "@/components/client/handover-section";
import { ShareFab } from "@/components/client/share-fab";
import { buildPresentationSlides } from "@/lib/presentation";
import { Lock } from "lucide-react";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function InvalidLink({ reason }: { reason: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="glass-strong flex max-w-sm flex-col items-center rounded-3xl px-10 py-14 text-center">
        <Lock size={20} className="text-ink/30" />
        <h1 className="mt-4 text-lg font-semibold text-ink">Link Unavailable</h1>
        <p className="mt-2 text-sm text-ink/55">{reason}</p>
      </div>
    </main>
  );
}

export default async function ClientProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const project = await getProjectByToken(token);

  if (!project) {
    return <InvalidLink reason="This project link is invalid. Please double-check the link NEON sent you." />;
  }
  if (project.publishState === "ARCHIVED") {
    return <InvalidLink reason="This project has been archived and is no longer accessible." />;
  }
  if (project.publishState !== "PUBLISHED") {
    return <InvalidLink reason="This project isn't published yet. Please check back soon, or contact NEON." />;
  }

  await logActivity(project.id, "viewed_project");

  const navItems: NavItem[] = [{ key: "overview", label: "Overview" }];
  if (project.spaces.some((s) => s.images.length > 0)) navItems.push({ key: "gallery", label: "Gallery" });
  if (project.drawings.length > 0) navItems.push({ key: "drawings", label: "Drawings" });
  if (project.materials.length > 0) navItems.push({ key: "materials", label: "Materials" });
  if (project.furniture.length > 0) navItems.push({ key: "furniture", label: "Furniture" });
  if (project.boqItems.length > 0) navItems.push({ key: "boq", label: "BOQ" });
  if (project.showPricing && project.pricingItems.length > 0) navItems.push({ key: "pricing", label: "Pricing" });
  if (project.documents.length > 0) navItems.push({ key: "documents", label: "Documents" });
  if (project.approvals.length > 0) navItems.push({ key: "approvals", label: "Approvals" });
  navItems.push({ key: "feedback", label: "Feedback" });
  navItems.push({ key: "handover", label: "Handover" });

  const spaceCount = project.spaces.filter((s) => s.images.length > 0).length;
  const slides = buildPresentationSlides(project);

  const checklist = [
    { label: "Final Renders", done: project.spaces.some((s) => s.images.length > 0) },
    { label: "Technical Drawings", done: project.drawings.length > 0 },
    { label: "Bill of Quantities", done: project.boqItems.length > 0 },
    { label: "Material Schedule", done: project.materials.length > 0 },
    { label: "Furniture Schedule", done: project.furniture.length > 0 },
    { label: "Execution Proposal", done: project.showPricing && project.pricingItems.length > 0 },
    { label: "Specifications & Documents", done: project.documents.length > 0 },
  ];

  return (
    <main className="bg-background">
      <WelcomeOverlay projectName={project.name} />
      <StickyNav items={navItems} projectName={project.name} />
      <MobileNav items={navItems} />
      <ShareFab projectName={project.name} />

      <Hero
        name={project.name}
        projectType={project.projectType}
        location={project.location}
        coverImageUrl={project.coverImageUrl}
        pipelineStatus={project.pipelineStatus}
        deliveryDate={project.deliveryDate}
        watermark={project.watermarkEnabled}
        slides={slides}
      />

      <OverviewSection
        clientName={project.clientName}
        location={project.location}
        area={project.area}
        projectType={project.projectType}
        description={project.description}
        spaceCount={spaceCount}
        completionPercent={project.completionPercent}
        currentStage={project.currentStage}
        deliveryDate={project.deliveryDate}
      />

      {navItems.some((n) => n.key === "gallery") && (
        <GallerySection
          spaces={project.spaces}
          allowDownloads={project.allowDownloads}
          token={project.token}
          watermark={project.watermarkEnabled}
        />
      )}

      {project.drawings.length > 0 && (
        <DrawingsSection drawings={project.drawings} allowDownloads={project.allowDownloads} token={project.token} />
      )}

      {project.materials.length > 0 && <MaterialsSection materials={project.materials} showPrice={project.showPricing} />}

      {project.furniture.length > 0 && <FurnitureSection furniture={project.furniture} showPrice={project.showPricing} />}

      {project.boqItems.length > 0 && (
        <BoqSection items={project.boqItems} showQuantities={project.showBoqQuantities} showPrices={project.showBoqPrices} />
      )}

      {project.showPricing && project.pricingItems.length > 0 && (
        <PricingSection items={project.pricingItems} showDetailed={project.showDetailedPricing} />
      )}

      {project.documents.length > 0 && (
        <DocumentsSection documents={project.documents} allowDownloads={project.allowDownloads} token={project.token} />
      )}

      {project.approvals.length > 0 && <ApprovalsSection token={project.token} approvals={project.approvals} />}

      <FeedbackSection token={project.token} comments={project.comments} />

      <HandoverSection
        token={project.token}
        isCompleted={project.pipelineStatus === "COMPLETED"}
        allowDownloads={project.allowDownloads}
        checklist={checklist}
      />
    </main>
  );
}
