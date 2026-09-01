"use client";

import { Palette } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { MaterialsBrowser, type MaterialRow } from "@/components/client/materials-browser";
import { useI18n } from "@/lib/client-i18n";

export function MaterialsSection({ materials, showPrice }: { materials: MaterialRow[]; showPrice: boolean }) {
  const { t } = useI18n();
  return (
    <SectionShell id="materials">
      <SectionHeader eyebrow={t("Review")} title={t("Material & Finish Board")} description={t("The materials, finishes, and surfaces selected for your space.")} />
      {materials.length === 0 ? (
        <EmptyState className="mt-8" icon={Palette} title={t("Material board coming soon")} description={t("Selected materials and finishes will appear here.")} />
      ) : (
        <MaterialsBrowser materials={materials} showPrice={showPrice} />
      )}
    </SectionShell>
  );
}
