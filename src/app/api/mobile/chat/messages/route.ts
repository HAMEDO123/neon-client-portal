import { NextResponse } from "next/server";
import { channelFor, listMessages, parseConversation } from "@/lib/chat";
import { postChatMessage, readChatAttachment } from "@/lib/chat-send";
import { mobileViewer } from "@/lib/mobile-auth";

// Reading and writing one conversation from a phone.
//
// A conversation is named exactly as it is on the web — "team", "manager", or
// an id — and what that name means depends on who is asking, which is why it
// goes through `parseConversation` with the viewer. `channelFor` is the access
// check: it refuses a conversation that is not theirs, so an id from somewhere
// else finds nothing rather than somebody else's messages.

export const dynamic = "force-dynamic";

const MAX_BODY = 4000;

/** The conversation a request names, opened for this viewer. */
async function open(viewer: Awaited<ReturnType<typeof mobileViewer>>, named: string | null) {
  if (!viewer) return null;
  const conversation = parseConversation(named && named.trim() ? named : "team", viewer);
  if (!conversation) return null;
  const channel = await channelFor(viewer, conversation);
  return channel ? { conversation, channel } : null;
}

export async function GET(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const opened = await open(viewer, url.searchParams.get("conversation"));
  if (!opened) return NextResponse.json({ error: "That conversation is not yours." }, { status: 404 });

  const asked = Number(url.searchParams.get("take") ?? 100);
  const take = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 200) : 100;

  return NextResponse.json({ messages: await listMessages(viewer, opened.channel.id, take) });
}

/**
 * Sending, with or without something attached.
 *
 * Two shapes on one route, because the app that exists already posts JSON and
 * must keep working: `application/json` for text, and `multipart/form-data`
 * when there is a photo, a file or a voice note. The multipart fields are the
 * same names the web chat box posts — `photo`, `document`, `voice`,
 * `durationSeconds` — and they are read by the same function, so a phone and a
 * browser cannot store the same photo under two different rules.
 */
export async function POST(request: Request) {
  const viewer = await mobileViewer(request);
  if (!viewer) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const multipart = (request.headers.get("content-type") ?? "").includes("multipart/form-data");

  let conversation: string | null = null;
  let text = "";
  let projectId: string | null = null;
  let attachment = {
    kind: "TEXT" as Awaited<ReturnType<typeof readChatAttachment>>["kind"],
    attachmentUrl: null as string | null,
    attachmentName: null as string | null,
    attachmentType: null as string | null,
    attachmentSize: null as number | null,
    durationSeconds: null as number | null,
  };

  if (multipart) {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "That upload could not be read." }, { status: 400 });
    }

    conversation = String(formData.get("conversation") ?? "") || null;
    text = String(formData.get("body") ?? "").trim().slice(0, MAX_BODY);
    projectId = String(formData.get("projectId") ?? "") || null;

    try {
      attachment = await readChatAttachment(formData);
    } catch (error) {
      // saveFile refuses what it will not store and says why — "PDF, DOCX,
      // XLSX, ZIP, MP4, DWG, or image (max 50MB)" is what the app should show.
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "That file could not be saved." },
        { status: 400 }
      );
    }
  } else {
    const body = await request.json().catch(() => null);
    conversation = typeof body?.conversation === "string" ? body.conversation : null;
    text = typeof body?.body === "string" ? body.body.trim().slice(0, MAX_BODY) : "";
    projectId = typeof body?.projectId === "string" && body.projectId ? body.projectId : null;
  }

  const opened = await open(viewer, conversation);
  if (!opened) return NextResponse.json({ error: "That conversation is not yours." }, { status: 404 });

  // Nothing said and nothing attached is not a message.
  if (attachment.kind === "TEXT" && !text) {
    return NextResponse.json({ error: "Nothing to send." }, { status: 400 });
  }

  const message = await postChatMessage(viewer, opened.conversation, opened.channel.id, {
    ...attachment,
    body: text || null,
    projectId,
  });

  return NextResponse.json({ message });
}
