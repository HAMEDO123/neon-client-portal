import { redirect } from "next/navigation";
import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { whatsAppChatUrl } from "@/lib/whatsapp-watch";

// The same WhatsApp tab, for the people the manager has trusted with it — since
// 2026-11-21 the studio's reply desk (lib/whatsapp-desk-proxy.ts) in a frame,
// as on the admin side. One guard for both portals, so they cannot disagree
// about who may read the studio's messages or answer in them.
//
// `fills-frame` is what takes the portal's padding and scrolling off this page,
// and the class has to be on the element this returns: the selector behind it
// (`.employee-main:has(> .fills-frame)` in globals.css) matches a direct child.

export const dynamic = "force-dynamic";

export default async function EmployeeWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string | string[] }>;
}) {
  try {
    await requireWhatsAppAccess();
  } catch {
    redirect("/employee");
  }

  // A notification about one chat opens that chat — in the chat section, where
  // the clients' conversations live beside the team's.
  const { chat } = await searchParams;
  if (typeof chat === "string" && chat) redirect(whatsAppChatUrl("employee", chat));

  return (
    // `wide-page`: and the whole width on a desk (globals.css), like Lead Finder.
    <div className="fills-frame wide-page flex h-full flex-col">
      <iframe src="/whatsapp-desk" title="WhatsApp" className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}
