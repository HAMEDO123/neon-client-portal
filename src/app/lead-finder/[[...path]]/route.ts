import { NextResponse, type NextRequest } from "next/server";
import { hasAdminSession } from "@/lib/session-token";
import {
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  rewriteLocation,
  upstreamUrl,
  withBase,
} from "@/lib/lead-finder-proxy";

// Lead Finder, served by the platform behind the manager's session
// (lib/lead-finder-proxy.ts). Every method it uses passes through here.

export const dynamic = "force-dynamic";
// A campaign or a review hunt can take a while to answer.
export const maxDuration = 300;

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  // A route handler is a public URL: it checks for the manager itself. A page
  // opened without the session goes to the sign-in; anything else is 404.
  if (!(await hasAdminSession())) {
    if (request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html")) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return new NextResponse("Not found", { status: 404 });
  }

  const { path = [] } = await context.params;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(path, request.nextUrl.search), {
      method: request.method,
      headers: forwardedRequestHeaders(request.headers),
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return new NextResponse(
      "Lead Finder isn't answering. It runs on the studio's PC — start it there (run.bat in the lead-finder folder).",
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const headers = forwardedResponseHeaders(upstream.headers);
  const location = rewriteLocation(upstream.headers.get("location"));
  if (location) headers.set("location", location);

  if ((upstream.headers.get("content-type") ?? "").includes("text/html")) {
    return new NextResponse(withBase(await upstream.text()), { status: upstream.status, headers });
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
