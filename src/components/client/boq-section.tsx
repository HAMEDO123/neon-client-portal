"use client";

import { ClipboardList } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BoqBrowser, type BoqRow } from "@/components/client/boq-browser";
import { useI18n } from "@/lib/client-i18n";

export function BoqSection({ items, showQuantities, showPrices }: { items: BoqRow[]; showQuantities: boolean; showPrices: boolean }) {
  const { t } = useI18n();
  return (
    <SectionShell id="boq">
      <SectionHeader eyebrow={t("Review")} title={t("Quantities & BOQ")} description={t("A complete breakdown of quantities and specifications for execution.")} />
      {items.length === 0 ? (
        <EmptyState className="mt-8" icon={ClipboardList} title={t("BOQ will be available once finalized")} description={t("Quantities and specifications will appear here once the take-off is complete.")} />
      ) : (
        <BoqBrowser items={items} showQuantities={showQuantities} showPrices={showPrices} />
      )}
    </SectionShell>
  );
}
