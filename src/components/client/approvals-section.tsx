import { CheckCircle2 } from "lucide-react";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ApprovalsBrowser, type ApprovalRow } from "@/components/client/approvals-browser";

export function ApprovalsSection({ token, approvals }: { token: string; approvals: ApprovalRow[] }) {
  return (
    <SectionShell id="approvals">
      <SectionHeader eyebrow="Approve" title="Design Approvals" description="Review each milestone and let NEON know if it’s ready to move forward." />
      {approvals.length === 0 ? (
        <EmptyState className="mt-8" icon={CheckCircle2} title="No approvals needed yet" description="Approval milestones will appear here as designs are ready for your review." />
      ) : (
        <ApprovalsBrowser token={token} approvals={approvals} />
      )}
    </SectionShell>
  );
}
