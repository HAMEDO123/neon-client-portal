import { sameOrigin } from "@/lib/request-origin";
import { hasAdminSession, sessionEmployeeId } from "@/lib/session-token";

// Where a browser reports an upload that failed without ever reaching us.
//
// The failures that cost days on 2026-10-03 left nothing in this server's log,
// because the reply that broke them was not ours — so the browser, which is the
// only witness, writes the line instead (lib/action-reply.ts). One line per
// failure, from somebody signed in, and nothing kept beyond the log.
//
// Never a cookie or a header: only what the page itself knew about the file and
// the reply. Every field is cut short and flattened to one line so a hostile
// body cannot forge entries in the log.

export const dynamic = "force-dynamic";

const flat = (value: unknown, max: number) =>
  String(value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, max);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });

  const who = (await hasAdminSession()) ? "admin" : await sessionEmployeeId();
  if (!who) return new Response(null, { status: 401 });

  const text = await request.text();
  if (text.length > 8_000) return new Response(null, { status: 413 });

  let body: {
    where?: unknown;
    page?: unknown;
    agent?: unknown;
    message?: unknown;
    files?: { name?: unknown; size?: unknown; type?: unknown }[];
    reply?: Record<string, unknown> | null;
  };
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const files = (Array.isArray(body.files) ? body.files : [])
    .slice(0, 10)
    .map((file) => `${flat(file?.name, 80)} ${Number(file?.size) || 0}B ${flat(file?.type, 40) || "?"}`)
    .join(", ");
  const reply = body.reply
    ? `status=${Number(body.reply.status) || 0} type=${flat(body.reply.contentType, 60)} server=${flat(body.reply.server, 40)} ray=${flat(body.reply.ray, 40)} said=${flat(body.reply.said, 120)}`
    : "reply=none";

  console.warn(
    `[upload-failed] who=${flat(who, 40)} where=${flat(body.where, 40)} page=${flat(body.page, 160)} files=[${files}] ${reply} message=${flat(body.message, 200)} agent=${flat(body.agent, 200)}`
  );

  return new Response(null, { status: 204 });
}
