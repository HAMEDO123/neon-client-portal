"use client";

import { useState } from "react";
import { Eye, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/format";
import { DocumentViewer, type ViewerFile } from "@/components/client/document-viewer";
import type { FullProject } from "@/lib/queries";
import { useI18n } from "@/lib/client-i18n";
import { cn } from "@/lib/utils";

// A client's documents as rows: what each is, a way to look at it, and a way
// to keep it when the studio allows that.
//
// Its own component because the same rows are drawn in two places — the
// Document Center, and the BOQ section for a bill of quantities that is a file
// (lib/boq-files.ts). The part that must not be written twice is the download
// link: it is offered only when `allowDownloads` is on, because the route
// behind it answers 404 otherwise, and a second copy of that condition is a
// button that leads nowhere the first time one copy is edited.

export function DocumentRows({
  documents,
  allowDownloads,
  token,
  showCategory = true,
  className,
}: {
  documents: FullProject["documents"];
  allowDownloads: boolean;
  token: string;
  /** Off where every row is the same kind of thing, and saying so on each is noise. */
  showCategory?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);

  return (
    <>
      <div className={cn("flex flex-col gap-2", className)}>
        {documents.map((d) => (
          <div key={d.id} className="glass flex flex-wrap items-center gap-3 rounded-xl p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink/40">
              <FileText size={16} strokeWidth={1.75} />
            </div>
            {showCategory && <Badge tone="purple">{d.category}</Badge>}
            <div className="min-w-0 flex-1">
              <p dir="auto" className="truncate text-sm font-medium text-ink">
                {d.title}
              </p>
              <p className="mt-0.5 text-xs text-ink/40">
                {d.version ? `${d.version} · ` : ""}
                {d.fileType.toUpperCase()} {d.fileSize ? `· ${formatFileSize(d.fileSize)}` : ""}
              </p>
            </div>
            <button
              onClick={() =>
                setViewerFile({
                  url: d.fileUrl,
                  downloadUrl: allowDownloads ? `/p/${token}/dl/document/${d.id}` : null,
                  name: d.title,
                  fileType: d.fileType,
                })
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/12 px-4 py-1.5 text-xs font-medium text-ink transition-colors hover:border-cyan-strong hover:text-cyan-strong"
            >
              <Eye size={13} /> {t("View")}
            </button>
            {allowDownloads && (
              <a href={`/p/${token}/dl/document/${d.id}`} className="rounded-full bg-ink px-4 py-1.5 text-xs font-medium text-bg">
                {t("Download")}
              </a>
            )}
          </div>
        ))}
      </div>

      <DocumentViewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </>
  );
}
