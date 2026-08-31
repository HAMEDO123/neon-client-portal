import { ClipboardList } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BoqBrowser, type BoqRow } from "@/components/client/boq-browser";

export function BoqSection({ items, showQuantities, showPrices }: { items: BoqRow[]; showQuantities: boolean; showPrices: boolean }) {
  return (
    <SectionShell id="boq">
      <SectionHeader eyebrow="Review" title="Quantities & BOQ" description="A complete breakdown of quantities and specifications for execution." />
      {items.length === 0 ? (
        <EmptyState className="mt-8" icon={ClipboardList} title="BOQ will be available once finalized" description="Quantities and specifications will appear here once the take-off is complete." />
      ) : (
        <BoqBrowser items={items} showQuantities={showQuantities} showPrices={showPrices} />
      )}
    </SectionShell>
  );
}
