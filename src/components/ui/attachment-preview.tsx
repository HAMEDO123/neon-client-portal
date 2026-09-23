import { FileText } from "lucide-react";
import { attachmentLabel, isImage } from "@/lib/attachments";
import { cn } from "@/lib/utils";

// A stored file, shown the way it can be shown.
//
// Proof of finished work is a photo most of the time and a PDF, a drawing or a
// spreadsheet the rest of it. An `<img>` pointed at a PDF draws a broken icon,
// which a manager reads as "the upload failed" rather than "this is a
// document" — so anything that is not an image gets a plain card saying what it
// is instead.
//
// The same className is passed either way, so the card fills exactly the box
// the picture would have: every caller keeps its own size and its own link.

export function AttachmentPreview({
  url,
  alt = "",
  className = "",
}: {
  url: string;
  alt?: string;
  className?: string;
}) {
  if (isImage(url)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={alt} loading="lazy" className={className} />;
  }

  return (
    <span
      className={cn("flex flex-col items-center justify-center gap-1 bg-ink/[0.05] text-ink/55", className)}
      title={alt || undefined}
    >
      <FileText size={18} strokeWidth={1.75} />
      <span className="px-1 text-center text-[10px] font-semibold uppercase tracking-wide leading-tight">
        {attachmentLabel(url)}
      </span>
    </span>
  );
}
