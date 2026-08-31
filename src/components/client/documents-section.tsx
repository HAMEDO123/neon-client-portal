"use client";

import { useState } from "react";
import { FolderOpen, Eye, FileText } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/lib/format";
import { DocumentViewer, type ViewerFile } from "@/components/client/document-viewer";
import type { FullProject } from "@/lib/queries";

export function DocumentsSection({
  documents,
  allowDownloads,
  token,
}: {
  documents: FullProject["documents"];
  allowDownloads: boolean;
  token: string;
}) {
  const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);

  return (
    <SectionShell id="documents">
      <SectionHeader eyebrow="Reference" title="Document Center" description="Contracts, specifications, reports, and every reference file in one place." />

      {documents.length === 0 ? (
        <EmptyState className="mt-8" icon={FolderOpen} title="No documents yet" description="Reference documents will appear here as they become available." />
      ) : (
        <div className="mt-8 flex flex-col gap-2">
          {documents.map((d) => (
            <div key={d.id} className="glass flex flex-wrap items-center gap-3 rounded-xl p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink/5 text-ink/40">
                <FileText size={16} strokeWidth={1.75} />
              </div>
              <Badge tone="purple">{d.category}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{d.title}</p>
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
                <Eye size={13} /> View
              </button>
              {allowDownloads && (
                <a href={`/p/${token}/dl/document/${d.id}`} className="rounded-full bg-ink px-4 py-1.5 text-xs font-medium text-bg">
                  Download
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <DocumentViewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </SectionShell>
  );
}
