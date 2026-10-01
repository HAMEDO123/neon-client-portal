import { getProjectByToken } from "@/lib/queries";

// Who a client app is, from the code it was given.
//
// The web has no login here at all: `/p/<token>` opens on the strength of the
// link, which *is* the credential. The app works the same way — it exchanges
// the code for the project's token once and then carries that token — so there
// is no new kind of access, no session to expire and nothing to sign. A token
// the manager regenerates stops working in the app exactly as it stops working
// in a browser, which is the behaviour the studio already understands.
//
// Not "use server": every export of one of those is a public endpoint.

/** The token on a request, from the header or, for a browser, nothing. */
function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token.length > 0 ? token : null;
}

export type ClientRefusal = { status: number; error: string };

/**
 * The project this request may read, or why it may not.
 *
 * The three answers are the same three `/p/[token]` gives, and the wording is
 * the client's rather than the platform's: a project that is not published is
 * not a bad token and must not be reported as one.
 */
export async function clientProject(request: Request) {
  const token = bearer(request);
  if (!token) {
    return { project: null, refusal: { status: 401, error: "Sign in with the code NEON gave you." } as ClientRefusal };
  }

  // The same read the web page makes, so the app cannot drift into showing a
  // different project from the link.
  const project = await getProjectByToken(token);

  if (!project) {
    return {
      project: null,
      refusal: { status: 401, error: "This project is no longer available. Ask NEON for a new code." } as ClientRefusal,
    };
  }
  if (project.publishState === "ARCHIVED") {
    return {
      project: null,
      refusal: { status: 403, error: "This project has been archived and is no longer available." } as ClientRefusal,
    };
  }
  if (project.publishState !== "PUBLISHED") {
    return {
      project: null,
      refusal: { status: 403, error: "This project isn't published yet. Please check back soon." } as ClientRefusal,
    };
  }

  return { project, refusal: null };
}
