import { prisma } from "@/lib/db";
import { refreshProject } from "@/lib/project-paths";
import { RpcError } from "@/lib/mobile/rpc";

// The studio answering a client on a project's comments, from the phone.
//
// The website has no server action for this: its comments tab resolves and
// removes, and the only reply the platform has ever had is the original admin
// app's route (api/mobile/projects/[id]/comments). This is that reply, written
// once as a lib function so the registry can put it behind the same guard as
// the rest of the comments tab (`requireStaff`: the team works a project
// exactly as the manager does).
//
// What it writes is what that route writes and what the client's page already
// knows how to show: `authorType: "ADMIN"`, which the client portal labels
// "NEON Team" (components/client/feedback-section.tsx).
//
// It deliberately does NOT log a "commented" activity, which the old route
// did: `ProjectActivity` is the client's trail ("Left a comment" in the
// project's analytics), and the studio's own answer counted there would read
// as the client engaging when they have not.

export const STUDIO_AUTHOR = "NEON Team";

export async function replyAsStudio(projectId: string, message: string, refLabel: string | null) {
  const text = message.trim();
  if (!text) throw new RpcError("Write the reply first.");

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new RpcError("That project no longer exists.", 404);

  const comment = await prisma.comment.create({
    data: {
      projectId,
      authorName: STUDIO_AUTHOR,
      authorType: "ADMIN",
      message: text,
      refLabel: refLabel?.trim() || null,
    },
    select: { id: true },
  });

  refreshProject(projectId, { tab: "comments" });
  return { id: comment.id };
}
