import { requireAdminRead } from "@/lib/admin-guard";

// Lead Finder, inside the admin (lib/lead-finder-proxy.ts): the whole app in
// the window beside the menu. "Open on its own" gives it the full screen, and
// is where the Facebook buttons it makes point to.

export const metadata = { title: "Lead Finder" };

export default async function LeadFinderPage() {
  await requireAdminRead();

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-warm-line bg-paper-soft px-4 py-2 lg:px-6">
        <p className="text-sm font-semibold text-bark">Lead Finder</p>
        <a
          href="/lead-finder"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-clay-deep hover:underline"
        >
          Open on its own
        </a>
      </div>
      <iframe src="/lead-finder" title="Lead Finder" className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}
