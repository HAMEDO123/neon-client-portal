import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { getMyReceipts } from "@/lib/payroll-queries";
import { getTimezone } from "@/lib/settings";
import { dayKeyToDate, todayKey } from "@/lib/time";
import { periodLabel, periodOf, RECEIPT_CAP } from "@/lib/payroll";
import { SupplyRequestForm, SupplyRequestList } from "@/components/employee/supply-requests";
import { ReceiptUploader, ReceiptList } from "@/components/employee/receipts";
import { DailyReport } from "@/components/employee/daily-report";
import { cn } from "@/lib/utils";

// One tab for the two things an employee asks the office for: something to be
// bought, and money back for something they already paid for.
export default async function EmployeeRequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const employee = await requireEmployee();
  const { tab } = await searchParams;
  const timezone = await getTimezone();
  const period = periodOf(todayKey(timezone));

  const showReceipts = tab === "receipts";
  const showReport = tab === "report";

  // One after another, the convention everywhere here: the local database drops
  // the connection when a page fires several at once. This was a Promise.all
  // and is now three reads rather than two, which is exactly when that starts
  // to bite.
  const requests = await prisma.supplyRequest.findMany({
    where: { employeeId: employee.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { lines: { orderBy: { position: "asc" } } },
  });
  const receipts = await getMyReceipts(employee.id, period);

  // Today's report, if there is one — the box opens with their own words in it,
  // because this is edited through the day rather than written once.
  const report = await prisma.dailyReport.findUnique({
    where: { employeeId_day: { employeeId: employee.id, day: dayKeyToDate(todayKey(timezone)) } },
    select: { text: true, updatedAt: true },
  });

  const counted = receipts.reduce((sum, receipt) => sum + (receipt.countedAmount ?? 0), 0);

  // The new UI (2026-11-18): on a desk the three sit side by side — supplies,
  // receipts and today's report — so nothing is behind a tab; on a phone the
  // buttons choose one. Each is rendered once and only hidden, so a form being
  // filled in is never a second copy of itself.
  const active = showReport ? "report" : showReceipts ? "receipts" : "supplies";
  const column = (key: string) => cn("flex min-w-0 flex-col gap-4", active === key ? "flex" : "hidden lg:flex");

  return (
    <div className="wide-page flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Requests</h1>
        <p className="mt-1 text-sm text-ink/50">
          Write up your day, ask for office supplies, or send in a receipt you paid for yourself.
        </p>
      </div>

      <div className="flex gap-2 lg:hidden">
        <Tab href="/employee/requests" active={active === "supplies"} label="Supplies" />
        <Tab href="/employee/requests?tab=receipts" active={active === "receipts"} label="Receipts" />
        {/* A plain apostrophe: this is a string attribute, not JSX text, so an
            HTML entity here would reach the screen as the entity itself. */}
        <Tab href="/employee/requests?tab=report" active={active === "report"} label="Today's report" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <section aria-label="Supplies" className={column("supplies")}>
          <h2 className="hidden text-2xl text-ink lg:block">Supplies</h2>
          <SupplyRequestForm />
          <SupplyRequestList requests={requests} />
        </section>

        <section aria-label="Receipts" className={column("receipts")}>
          <h2 className="hidden text-2xl text-ink lg:block">Receipts</h2>
          <div className="rounded-2xl bg-clay-soft p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-ink/50">{periodLabel(period)}</p>
            <p className="mt-1 font-display text-3xl text-ink">{counted.toFixed(2)} JOD</p>
            <p className="mt-1 text-xs text-ink/55">
              {receipts.length} receipt{receipts.length === 1 ? "" : "s"} · each one counts up to {RECEIPT_CAP} JOD
              unless the manager sets another figure, added to this month&apos;s pay
            </p>
          </div>
          <ReceiptUploader />
          <ReceiptList receipts={receipts} />
        </section>

        <section aria-label="Today's report" className={column("report")}>
          <h2 className="hidden text-2xl text-ink lg:block">Today&apos;s report</h2>
          <DailyReport today={report?.text ?? ""} savedAt={report?.updatedAt ?? null} />
        </section>
      </div>
    </div>
  );
}

function Tab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <a
      href={href}
      className={
        active
          ? "flex-1 rounded-full border border-ink bg-ink px-4 py-2 text-center text-sm font-medium text-bg"
          : "flex-1 rounded-full border border-ink/12 bg-white/60 px-4 py-2 text-center text-sm font-medium text-ink/60"
      }
    >
      {label}
    </a>
  );
}
