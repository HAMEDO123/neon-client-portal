import { redirect } from "next/navigation";
import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { whatsAppChatUrl } from "@/lib/whatsapp-watch";

// The company number's WhatsApp, in the dashboard — since 2026-11-21 the
// studio's reply desk (lib/whatsapp-desk-proxy.ts) instead of the old inbox:
// "حطه بدل خانة الواتساب القديمه". The desk runs on the studio's PC with its own
// linked session, Claude's drafts and automatic replies, the brief and the
// appointment book; this page is that desk in a frame filling the window
// (`fillsWindow`), with "Open on its own" for the full screen.
//
// The old inbox (`components/whatsapp/whatsapp-inbox.tsx`) and the worker are
// untouched — the team's chat list still reads the worker — so going back is
// putting the old page body here again.

export const dynamic = "force-dynamic";

export default async function AdminWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string | string[] }>;
}) {
  try {
    await requireWhatsAppAccess();
  } catch {
    redirect("/admin");
  }

  // A notification about one chat opens that chat — in the chat section, where
  // the clients' conversations live beside the team's. The notification keeps
  // this address because the phone app reads these paths too.
  const { chat } = await searchParams;
  if (typeof chat === "string" && chat) redirect(whatsAppChatUrl("admin", chat));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-warm-line bg-paper-soft px-4 py-2 lg:px-6">
        <p className="text-sm font-semibold text-bark">WhatsApp</p>
        <a
          href="/whatsapp-desk"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-clay-deep hover:underline"
        >
          Open on its own
        </a>
      </div>
      <iframe src="/whatsapp-desk" title="WhatsApp" className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}
