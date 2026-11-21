import { NextResponse, type NextRequest } from "next/server";
import { hasAdminSession } from "@/lib/session-token";
import { getSessionEmployee } from "@/lib/employee-session";
import {
  forwardedRequestHeaders,
  forwardedResponseHeaders,
  upstreamUrl,
  withBase,
} from "@/lib/whatsapp-desk-proxy";

// The WhatsApp reply desk, served by the platform (lib/whatsapp-desk-proxy.ts).
// Every method it uses passes through here, including its live event stream.

export const dynamic = "force-dynamic";
// A draft or a brief from Claude can take a while; the event stream stays open.
export const maxDuration = 300;

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  // A route handler is a public URL: it checks for itself. The same people as
  // the old WhatsApp tab (`requireWhatsAppAccess`): the manager, or somebody
  // the manager has trusted with the company number (`canReadWhatsApp`).
  if (!(await hasAdminSession()) && !(await getSessionEmployee())?.canReadWhatsApp) {
    if (request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html")) {
      // A relative address: inside the container request.url is localhost:3000.
      return new NextResponse(null, { status: 307, headers: { location: "/employee/login" } });
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
      // When the browser leaves, the desk's event stream is closed too.
      signal: request.signal,
    });
  } catch {
    return new NextResponse(
      "The WhatsApp desk isn't answering. It runs on the studio's PC — start it there (start.bat in the whatsapp-claude folder).",
      { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }
    );
  }

  const headers = forwardedResponseHeaders(upstream.headers);
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
