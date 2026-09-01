"use client";

import Image from "next/image";
import { Sofa } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency } from "@/lib/format";
import type { FullProject } from "@/lib/queries";
import { useI18n } from "@/lib/client-i18n";

export function FurnitureSection({ furniture, showPrice }: { furniture: FullProject["furniture"]; showPrice: boolean }) {
  const { t } = useI18n();
  return (
    <SectionShell id="furniture">
      <SectionHeader eyebrow={t("Review")} title={t("Furniture & Product Schedule")} description={t("Every piece specified for your project, ready for procurement.")} />
      {furniture.length === 0 ? (
        <EmptyState className="mt-8" icon={Sofa} title={t("Furniture schedule coming soon")} description={t("Selected furniture and products will appear here.")} />
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {furniture.map((f) => (
            <div key={f.id} className="glass overflow-hidden rounded-2xl">
              <div className="relative aspect-square bg-ink/5">
                {f.imageUrl && <Image src={f.imageUrl} alt={f.name} fill unoptimized className="object-cover" />}
              </div>
              <div className="p-4">
                <p className="text-sm font-medium text-ink">{f.name}</p>
                <p className="mt-0.5 text-xs text-ink/45">
                  {f.space ? `${f.space} · ` : ""}{t("Qty")} {f.quantity}
                </p>
                {(f.brand || f.dimensions) && (
                  <p className="mt-1 text-xs text-ink/40">{[f.brand, f.dimensions].filter(Boolean).join(" · ")}</p>
                )}
                {showPrice && f.price != null && <p className="mt-2 text-sm font-medium text-ink">{formatCurrency(f.price)}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionShell>
  );
}
