"use client";

import { useMemo, useState } from "react";
import { FileText, Eye, History, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatFileSize } from "@/lib/format";
import { DocumentViewer, type ViewerFile } from "@/components/client/document-viewer";

export interface DrawingRow {
  id: string;
  category: string;
  subCategory: string | null;
  name: string;
  drawingNumber: string | null;
  revision: string;
  fileUrl: string;
  fileType: string;
  fileSize: number | null;
  revisions: { id: string; revision: string; note: string | null; createdAt: Date }[];
}

export function DrawingsBrowser({ drawings, allowDownloads, token }: { drawings: DrawingRow[]; allowDownloads: boolean; token: string }) {
  const categories = useMemo(() => ["All", ...Array.from(new Set(drawings.map((d) => d.category)))], [drawings]);
  const [active, setActive] = useState("All");
  const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);

  const filtered = active === "All" ? drawings : drawings.filter((d) => d.category === active);

  return (
    <>
      <div className="scrollbar-none mt-8 flex gap-2 overflow-x-auto">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setActive(c)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-2 text-xs font-medium transition-colors",
              active === c ? "border-ink bg-ink text-bg" : "border-ink/10 bg-white/50 text-ink/60 hover:border-cyan-strong hover:text-cyan-strong"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((d) => (
          <div key={d.id} className="glass flex flex-col gap-3 rounded-2xl p-5">
            <div className="flex items-start justify-between gap-2">
              <Badge tone="cyan">{d.category}</Badge>
              <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[10px] font-semibold text-ink/60">{d.revision}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-ink/5 text-ink/40">
                <FileText size={18} strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{d.name}</p>
                <p className="truncate text-xs text-ink/40">
                  {d.drawingNumber ?? d.subCategory ?? d.fileType.toUpperCase()}
                  {d.fileSize ? ` · ${formatFileSize(d.fileSize)}` : ""}
                </p>
              </div>
            </div>
            <div className="mt-1 flex gap-2">
              <button
                onClick={() =>
                  setViewerFile({
                    url: d.fileUrl,
                    downloadUrl: allowDownloads ? `/p/${token}/dl/drawing/${d.id}` : null,
                    name: d.name,
                    fileType: d.fileType,
                  })
                }
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-ink/12 py-2 text-xs font-medium text-ink transition-colors hover:border-cyan-strong hover:text-cyan-strong"
              >
                <Eye size={13} /> View
              </button>
              {allowDownloads && (
                <a
                  href={`/p/${token}/dl/drawing/${d.id}`}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-ink py-2 text-xs font-medium text-bg"
                >
                  Download
                </a>
              )}
            </div>

            {d.revisions.length > 0 && (
              <div>
                <button
                  onClick={() => setHistoryOpen(historyOpen === d.id ? null : d.id)}
                  className="flex items-center gap-1.5 text-xs font-medium text-ink/45 hover:text-ink"
                >
                  <History size={12} />
                  Revision History
                  <ChevronDown size={12} className={cn("transition-transform", historyOpen === d.id && "rotate-180")} />
                </button>
                {historyOpen === d.id && (
                  <div className="mt-2 flex flex-col gap-1.5 border-t border-ink/8 pt-2">
                    <div className="flex items-center justify-between text-[11px] text-ink/50">
                      <span className="font-semibold">{d.revision} · Current</span>
                    </div>
                    {d.revisions.map((r) => (
                      <div key={r.id} className="flex items-center justify-between text-[11px] text-ink/40">
                        <span>
                          {r.revision}
                          {r.note ? ` — ${r.note}` : ""}
                        </span>
                        <span className="shrink-0">{formatDate(r.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <DocumentViewer file={viewerFile} onClose={() => setViewerFile(null)} />
    </>
  );
}
