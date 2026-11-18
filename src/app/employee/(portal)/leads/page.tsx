import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/employee-session";

// Lead Finder in the team's portal, for whoever the manager ticked
// (`Employee.canUseLeadFinder`) — the same app as the manager's /admin/leads,
// served by the platform at /lead-finder (lib/lead-finder-proxy.ts).

export const metadata = { title: "Lead Finder" };

export default async function EmployeeLeadFinderPage() {
  const employee = await requireEmployee();
  if (!employee.canUseLeadFinder) notFound();

  return (
    // `fills-frame`: the page takes the whole frame and scrolls inside the app.
    <div className="fills-frame flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-warm-line bg-paper-soft px-4 py-2">
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
