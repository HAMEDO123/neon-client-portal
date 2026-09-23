import { redirect } from "next/navigation";
import { getTimezone } from "@/lib/settings";
import { requireWhatsAppReader } from "@/lib/admin-guard";
import { whatsAppChats } from "@/lib/whatsapp/worker";
import { WhatsAppInbox } from "@/components/whatsapp/whatsapp-inbox";

// The company number's WhatsApp, in the dashboard.
//
// The studio runs on one WhatsApp number, and reading it used to mean holding
// the phone. This is that number's conversations, read-only, for the manager
// and for whoever the manager has trusted with it.
//
// The first load is server-side so the page arrives with the chats already on
// it; everything after that the component refreshes for itself.

export const dynamic = "force-dynamic";

export default async function AdminWhatsAppPage() {
  try {
    await requireWhatsAppReader();
  } catch {
    redirect("/admin");
  }

  const timezone = await getTimezone();
  const result = await whatsAppChats();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">WhatsApp</h1>
      <p className="mt-1 text-sm text-ink/50">
        The studio&rsquo;s own number, as it stands on the phone. Reading only &mdash; nothing here sends a message, and
        opening a chat does not mark it read on the handset.
      </p>

      <div className="mt-6">
        <WhatsAppInbox
          initialChats={result.ok ? result.data.chats : []}
          initialError={result.ok ? null : result.error}
          timeZone={timezone}
        />
      </div>
    </div>
  );
}
