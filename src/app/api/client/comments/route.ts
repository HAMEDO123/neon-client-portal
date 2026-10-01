import { NextResponse } from "next/server";
import { clientProject } from "@/lib/client-auth";
import { createComment } from "@/lib/actions/comment-actions";

// A client writing to the studio from the app.
//
// Through the website's own `createComment`, which is scoped by the token and
// logs the activity — see the note in the approvals route.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { project, refusal } = await clientProject(request);
  if (!project) return NextResponse.json({ error: refusal.error }, { status: refusal.status });

  let body: { message?: unknown; authorName?: unknown; refLabel?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send this as JSON." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  // `createComment` returns quietly on an empty message, which is right for a
  // form post and wrong for an app: it would read as sent and never appear.
  if (message.length === 0) {
    return NextResponse.json({ error: "Write something first." }, { status: 400 });
  }

  const form = new FormData();
  form.set("message", message);
  form.set("authorName", typeof body.authorName === "string" ? body.authorName : "");
  form.set("refLabel", typeof body.refLabel === "string" ? body.refLabel : "");

  await createComment(project.token, form);

  return NextResponse.json({ ok: true });
}
