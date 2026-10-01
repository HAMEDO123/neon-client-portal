import { NextResponse } from "next/server";
import { projectForCode } from "@/lib/client-access";
import { logActivity } from "@/lib/activity";

// A client signing in to the app with the code the studio gave them.
//
// There is no username and no password, by the studio's decision and in
// keeping with how this has always worked: the link to `/p/<token>` is the
// credential on the web, and the code is the same credential in a shape
// somebody can be told over the phone. What comes back is that token, which
// the app keeps and sends on every later call.
//
// So "signing in" is an exchange, not a session: nothing here expires, and the
// manager revokes it exactly as they already revoke a link.
//
// No origin check, deliberately, for the reason `lib/mobile-auth.ts` gives: a
// cookie is attached by the browser to any request, which is what makes that
// check necessary for the cookie routes; nothing attaches this body but the
// app that holds the code.

export const dynamic = "force-dynamic";

/**
 * Who is asking, for the attempt limit.
 *
 * Behind the Cloudflare tunnel every request arrives from the same container,
 * so the real address is in a header. `cf-connecting-ip` is set by Cloudflare
 * itself and cannot be spoofed past it; the others are fallbacks for running
 * without the tunnel. A caller we cannot identify shares one bucket, which is
 * stricter than letting them have an unlimited one each.
 */
function callerOf(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function POST(request: Request) {
  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send this as JSON with a `code`." }, { status: 400 });
  }

  const typed = typeof body.code === "string" ? body.code : "";
  if (typed.trim().length === 0) {
    return NextResponse.json({ error: "Enter the code NEON gave you." }, { status: 400 });
  }

  const result = await projectForCode(typed, callerOf(request));

  if (!result.ok) {
    // Each refusal says the one true thing about itself. A draft project
    // answered as "wrong code" is what makes a client ring the studio to say
    // their code is broken when it is the project that is not ready.
    const said = {
      unknown: { status: 401, error: "That code is not right. Please check it with NEON." },
      draft: { status: 403, error: "This project isn't ready to view yet. NEON will let you know." },
      archived: { status: 403, error: "This project has been archived and is no longer available." },
      "too-many": { status: 429, error: "Too many tries. Please wait a few minutes and try again." },
    }[result.reason];

    return NextResponse.json({ error: said.error }, { status: said.status });
  }

  // The manager sees this in the project's activity, as they see a link being
  // opened: it is how they learn the code reached the client and worked. The
  // existing type, with the app said in the detail — a new `ActivityType` would
  // be a column of its own and every screen that reads one would need the case
  // adding, for a line that already says what it needs to.
  await logActivity(result.projectId, "viewed_project", "Signed in on the app");

  return NextResponse.json({
    token: result.token,
    name: result.name,
    clientName: result.clientName,
  });
}
