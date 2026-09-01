"use client";

import { MapPin, Ruler, LayoutGrid, User, CalendarClock, Gauge } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { JourneyTimeline } from "@/components/client/journey-timeline";
import { formatDate } from "@/lib/format";
import { useI18n } from "@/lib/client-i18n";

export function OverviewSection({
  clientName,
  location,
  area,
  projectType,
  description,
  spaceCount,
  completionPercent,
  currentStage,
  deliveryDate,
}: {
  clientName: string;
  location: string | null;
  area: string | null;
  projectType: string | null;
  description: string | null;
  spaceCount: number;
  completionPercent: number;
  currentStage: string;
  deliveryDate: Date | null;
}) {
  const { t } = useI18n();
  const facts = [
    { icon: User, label: t("Client"), value: clientName },
    { icon: MapPin, label: t("Location"), value: location ?? "—" },
    { icon: Ruler, label: t("Area"), value: area ?? "—" },
    { icon: LayoutGrid, label: t("Design Scope"), value: projectType ?? "—" },
    { icon: Gauge, label: t("Spaces"), value: spaceCount ? t("{n} spaces", { n: spaceCount }) : "—" },
    { icon: CalendarClock, label: t("Delivery"), value: deliveryDate ? formatDate(deliveryDate) : t("To be confirmed") },
  ];

  return (
    <SectionShell id="overview">
      <SectionHeader eyebrow={t("Discover")} title={t("Project Overview")} description={description ?? undefined} />

      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {facts.map((f) => (
          <div key={f.label} className="glass rounded-2xl p-4">
            <f.icon size={16} strokeWidth={1.75} className="text-cyan-strong" />
            <p className="mt-3 text-xs text-ink/45">{f.label}</p>
            <p className="mt-0.5 truncate text-sm font-medium text-ink">{f.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-12">
        <JourneyTimeline currentStage={currentStage} completionPercent={completionPercent} />
      </div>
    </SectionShell>
  );
}
