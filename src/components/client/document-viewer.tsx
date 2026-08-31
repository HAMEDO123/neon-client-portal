"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Download, ExternalLink } from "lucide-react";

export interface ViewerFile {
  url: string;
  downloadUrl: string | null;
  name: string;
  fileType: string;
}

const IMAGE_TYPES = ["jpg", "jpeg", "png", "webp", "avif", "gif"];

export function DocumentViewer({ file, onClose }: { file: ViewerFile | null; onClose: () => void }) {
  useEffect(() => {
    if (!file) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [file, onClose]);

  const canPreview = file && (file.fileType === "pdf" || IMAGE_TYPES.includes(file.fileType));

  return (
    <AnimatePresence>
      {file && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex flex-col bg-ink/97 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <p className="truncate pr-4 text-sm font-medium text-white">{file.name}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              {file.downloadUrl && (
                <a href={file.downloadUrl} className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white" aria-label="Download">
                  <Download size={18} />
                </a>
              )}
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Open in new tab"
              >
                <ExternalLink size={18} />
              </a>
              <button onClick={onClose} className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white" aria-label="Close">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-hidden px-2 pb-2 sm:px-6 sm:pb-6">
            {canPreview ? (
              file.fileType === "pdf" ? (
                <iframe src={file.url} title={file.name} className="h-full w-full rounded-xl bg-white" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={file.url} alt={file.name} className="mx-auto h-full max-h-full object-contain" />
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-white/60">
                <p className="text-sm">Preview isn&apos;t available for this file type ({file.fileType.toUpperCase()}).</p>
                {file.downloadUrl && (
                  <a href={file.downloadUrl} className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-ink">
                    Download to view
                  </a>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
