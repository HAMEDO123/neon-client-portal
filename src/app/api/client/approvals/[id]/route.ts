import { NextResponse } from "next/server";
import { clientProject } from "@/lib/client-auth";
import { respondToApproval } from "@/lib/actions/approval-actions";

// A client answering an approval from the app.
//
// It calls the website's own `respondToApproval` rather than writing the row
// here: that function is already scoped by the project's token in its `where`,
// which is the whole access check, and it logs the activity the manager reads.
// A second copy would be a second place for either to be forgotten.

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { project, refusal } = await clientProject(request);
  if (!project) return NextResponse.json({ error: refusal.error }, { status: refusal.status });

  let body: { status?: unknown; clientName?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send this as JSON." }, { status: 400 });
  }

  if (body.status !== "APPROVED" && body.status !== "CHANGES_REQUESTED") {
    return NextResponse.json({ error: "Say whether this is approved or needs changes." }, { status: 400 });
  }

  // Asking for changes with nothing written tells the studio less than the
  // approval already did — the same refusal `needsReport` makes of a site
  // visit. Approving needs no words.
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (body.status === "CHANGES_REQUESTED" && note.length === 0) {
    return NextResponse.json({ error: "Please say what needs changing." }, { status: 400 });
  }

  const { id } = await context.params;
  const form = new FormData();
  form.set("clientName", typeof body.clientName === "string" ? body.clientName : "");
  form.set("note", note);

  try {
    await respondToApproval(project.token, id, body.status, form);
  } catch {
    // The only thing it throws is "Not found", for an approval that is not on
    // this project — which is what an id from somewhere else looks like.
    return NextResponse.json({ error: "That item is not on this project." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, status: body.status });
}
