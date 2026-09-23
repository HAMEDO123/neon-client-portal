import { NextResponse } from "next/server";
import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { whatsAppChats } from "@/lib/whatsapp/worker";

// The company number's conversations, for the portal's WhatsApp tab.
//
// A route rather than a server action because the tab refreshes itself while
// somebody watches it, and an action cannot be polled. The guard is the same
// one the page uses: being signed in is not enough, and being on the team is
// not enough either.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireWhatsAppAccess();
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const limit = Number(new URL(request.url).searchParams.get("limit")) || 50;
  const result = await whatsAppChats(limit);
  if (!result.ok) {
    // The worker's own words: "line is not linked" is what the reader needs to
    // see, not a status code.
    return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });
  }

  return NextResponse.json(result.data);
}
