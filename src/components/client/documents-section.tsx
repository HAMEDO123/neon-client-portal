"use client";

import { FolderOpen } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentRows } from "@/components/client/document-rows";
import type { FullProject } from "@/lib/queries";
import { useI18n } from "@/lib/client-i18n";

export function DocumentsSection({
  documents,
  allowDownloads,
  token,
}: {
  documents: FullProject["documents"];
  allowDownloads: boolean;
  token: string;
}) {
  const { t } = useI18n();

  return (
    <SectionShell id="documents">
      <SectionHeader eyebrow={t("Reference")} title={t("Document Center")} description={t("Contracts, specifications, reports, and every reference file in one place.")} />

      {documents.length === 0 ? (
        <EmptyState className="mt-8" icon={FolderOpen} title={t("No documents yet")} description={t("Reference documents will appear here as they become available.")} />
      ) : (
        // The rows are shared with the BOQ section, which shows a bill of
        // quantities that was added as a file — see document-rows.tsx.
        <DocumentRows className="mt-8" documents={documents} allowDownloads={allowDownloads} token={token} />
      )}
    </SectionShell>
  );
}
