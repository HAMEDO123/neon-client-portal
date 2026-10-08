"use client";

import { ClipboardList } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BoqBrowser, type BoqRow } from "@/components/client/boq-browser";
import { DocumentRows } from "@/components/client/document-rows";
import type { FullProject } from "@/lib/queries";
import { useI18n } from "@/lib/client-i18n";

// The bill of quantities, as the studio put it on the project: a file, a table
// of items, or both.
//
// **The file comes first.** A BOQ that was added as a spreadsheet or a PDF is
// the studio's own finished document, and where there is one it is what the
// client came to this section for; the searchable table under it is the same
// information taken apart, or a different BOQ altogether.
//
// The two are hidden differently, and only one of them can be: `showQuantities`
// and `showPrices` leave columns out of the table, and nothing here can leave a
// column out of somebody's spreadsheet. The screen where the file is added says
// so to whoever adds it (the BOQ tab), which is the only place it can be said
// in time.

export function BoqSection({
  items,
  files = [],
  showQuantities,
  showPrices,
  allowDownloads = false,
  token = "",
}: {
  items: BoqRow[];
  /** The BOQ as a file — documents filed under "BOQ" (lib/boq-files.ts). */
  files?: FullProject["documents"];
  showQuantities: boolean;
  showPrices: boolean;
  allowDownloads?: boolean;
  token?: string;
}) {
  const { t } = useI18n();
  return (
    <SectionShell id="boq">
      <SectionHeader eyebrow={t("Review")} title={t("Quantities & BOQ")} description={t("A complete breakdown of quantities and specifications for execution.")} />

      {items.length === 0 && files.length === 0 && (
        <EmptyState className="mt-8" icon={ClipboardList} title={t("BOQ will be available once finalized")} description={t("Quantities and specifications will appear here once the take-off is complete.")} />
      )}

      {files.length > 0 && (
        <DocumentRows className="mt-8" documents={files} allowDownloads={allowDownloads} token={token} showCategory={false} />
      )}

      {items.length > 0 && <BoqBrowser items={items} showQuantities={showQuantities} showPrices={showPrices} />}
    </SectionShell>
  );
}
