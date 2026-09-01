"use client";

import { FileStack } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DrawingsBrowser, type DrawingRow } from "@/components/client/drawings-browser";
import { useI18n } from "@/lib/client-i18n";

export function DrawingsSection({ drawings, allowDownloads, token }: { drawings: DrawingRow[]; allowDownloads: boolean; token: string }) {
  const { t } = useI18n();
  return (
    <SectionShell id="drawings">
      <SectionHeader
        eyebrow={t("Review")}
        title={t("Technical Drawings")}
        description={t("Architectural, ceiling, electrical, HVAC, plumbing, and joinery documentation — organized and ready to review.")}
      />
      {drawings.length === 0 ? (
        <EmptyState className="mt-8" icon={FileStack} title={t("Drawings in progress")} description={t("Technical drawings will appear here once released by the design team.")} />
      ) : (
        <DrawingsBrowser drawings={drawings} allowDownloads={allowDownloads} token={token} />
      )}
    </SectionShell>
  );
}
