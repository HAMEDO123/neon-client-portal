import { NextResponse } from "next/server";
import { clientProject } from "@/lib/client-auth";
import { clientPayload } from "@/lib/client-payload";
import { logActivity } from "@/lib/activity";

// Everything the client's app draws, in one answer.
//
// One call rather than a route per section: a phone on a Jordanian mobile
// connection pays for each round trip, the whole project is already read in one
// query (`fullProjectInclude`, the same one the web page uses), and a client
// opening the app wants the project rather than a tab of it.
//
// What a client may see is decided in `lib/client-payload.ts`, by leaving
// things out — never by sending them with a flag asking the app not to draw
// them.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { project, refusal } = await clientProject(request);
  if (!project) return NextResponse.json({ error: refusal.error }, { status: refusal.status });

  // The manager watches this the way they watch the link being opened.
  await logActivity(project.id, "viewed_project", "Opened the app");

  return NextResponse.json(clientPayload(project));
}
