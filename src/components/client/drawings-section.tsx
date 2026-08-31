import { FileStack } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DrawingsBrowser, type DrawingRow } from "@/components/client/drawings-browser";

export function DrawingsSection({ drawings, allowDownloads, token }: { drawings: DrawingRow[]; allowDownloads: boolean; token: string }) {
  return (
    <SectionShell id="drawings">
      <SectionHeader
        eyebrow="Review"
        title="Technical Drawings"
        description="Architectural, ceiling, electrical, HVAC, plumbing, and joinery documentation — organized and ready to review."
      />
      {drawings.length === 0 ? (
        <EmptyState className="mt-8" icon={FileStack} title="Drawings in progress" description="Technical drawings will appear here once released by the design team." />
      ) : (
        <DrawingsBrowser drawings={drawings} allowDownloads={allowDownloads} token={token} />
      )}
    </SectionShell>
  );
}
