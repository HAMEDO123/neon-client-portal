import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { createApproval, deleteApproval } from "@/lib/actions/approval-actions";
import { TextInput } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";

const STATUS_TONE = { PENDING: "warning", APPROVED: "success", CHANGES_REQUESTED: "orange" } as const;
const STATUS_LABEL = { PENDING: "Pending Review", APPROVED: "Approved", CHANGES_REQUESTED: "Changes Requested" } as const;

export default async function ApprovalsAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-6">
      <form action={createApproval.bind(null, project.id)} className="glass flex items-end gap-3 rounded-2xl p-5">
        <TextInput label="Add a milestone for client approval" name="itemLabel" placeholder="Living Room Design" defaultValue="" className="flex-1" />
        <SaveButton label="Add Milestone" />
      </form>

      {project.approvals.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No approval milestones yet" description="Add design milestones for the client to review and approve." />
      ) : (
        <div className="flex flex-col gap-2">
          {project.approvals.map((a) => (
            <div key={a.id} className="glass flex flex-wrap items-center gap-3 rounded-xl p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{a.itemLabel}</p>
                {a.note && <p className="mt-1 text-sm text-ink/60">“{a.note}”</p>}
                {a.respondedAt && (
                  <p className="mt-1 text-xs text-ink/40">
                    {a.clientName ? `${a.clientName} · ` : ""}
                    {formatDate(a.respondedAt)}
                  </p>
                )}
              </div>
              <Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge>
              <form>
                <DeleteButton formAction={deleteApproval.bind(null, project.id, a.id)} />
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
