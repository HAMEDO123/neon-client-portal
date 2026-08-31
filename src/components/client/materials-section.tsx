import { Palette } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { MaterialsBrowser, type MaterialRow } from "@/components/client/materials-browser";

export function MaterialsSection({ materials, showPrice }: { materials: MaterialRow[]; showPrice: boolean }) {
  return (
    <SectionShell id="materials">
      <SectionHeader eyebrow="Review" title="Material & Finish Board" description="The materials, finishes, and surfaces selected for your space." />
      {materials.length === 0 ? (
        <EmptyState className="mt-8" icon={Palette} title="Material board coming soon" description="Selected materials and finishes will appear here." />
      ) : (
        <MaterialsBrowser materials={materials} showPrice={showPrice} />
      )}
    </SectionShell>
  );
}
