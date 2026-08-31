import { notFound } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { getProjectById } from "@/lib/queries";
import { resolveComment, deleteComment } from "@/lib/actions/comment-actions";
import { DeleteButton } from "@/components/admin/form-buttons";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { buttonClasses } from "@/components/ui/buttons";

export default async function CommentsAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) notFound();

  return (
    <div className="flex flex-col gap-3">
      {project.comments.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No comments yet" description="Client feedback and change requests will appear here." />
      ) : (
        project.comments.map((c) => (
          <div key={c.id} className="glass rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-ink">{c.authorName}</p>
                {c.refLabel && <Badge tone="cyan">{c.refLabel}</Badge>}
                <Badge tone={c.status === "OPEN" ? "warning" : "success"}>{c.status}</Badge>
              </div>
              <p className="text-xs text-ink/40">{formatDate(c.createdAt)}</p>
            </div>
            <p className="mt-2 text-sm text-ink/70">{c.message}</p>
            <div className="mt-3 flex gap-2">
              <form>
                <button
                  formAction={resolveComment.bind(null, project.id, c.id, c.status === "OPEN" ? "RESOLVED" : "OPEN")}
                  className={buttonClasses("outline", "sm")}
                >
                  Mark {c.status === "OPEN" ? "Resolved" : "Open"}
                </button>
              </form>
              <form>
                <DeleteButton formAction={deleteComment.bind(null, project.id, c.id)} />
              </form>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
