import { AttachmentPreview } from "@/components/ui/attachment-preview";
import { cn } from "@/lib/utils";

/** A row of small pictures, each opening whole: the proof files after the first. */
export function ProofThumbs({ urls, label, className }: { urls: string[]; label: string; className?: string }) {
  if (urls.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {urls.map((url, index) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-ink/10">
            <AttachmentPreview url={url} alt={`${label}, file ${index + 2}`} className="h-16 w-16 object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}
