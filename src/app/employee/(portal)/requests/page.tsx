import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { getMyReceipts } from "@/lib/payroll-queries";
import { getTimezone } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { periodLabel, periodOf, RECEIPT_CAP } from "@/lib/payroll";
import { SupplyRequestForm, SupplyRequestList } from "@/components/employee/supply-requests";
import { ReceiptUploader, ReceiptList } from "@/components/employee/receipts";

// One tab for the two things an employee asks the office for: something to be
// bought, and money back for something they already paid for.
export default async function EmployeeRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const employee = await requireEmployee();
  const { tab } = await searchParams;
  const timezone = await getTimezone();
  const period = periodOf(todayKey(timezone));

  const showReceipts = tab === "receipts";

  const [requests, receipts] = await Promise.all([
    prisma.supplyRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    getMyReceipts(employee.id, period),
  ]);

  const counted = receipts.reduce((sum, receipt) => sum + (receipt.countedAmount ?? 0), 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">Requests</h1>
        <p className="mt-1 text-sm text-ink/50">
          Ask for office supplies, or send in a receipt you paid for yourself.
        </p>
      </div>

      <div className="flex gap-2">
        <Tab href="/employee/requests" active={!showReceipts} label="Office supplies" />
        <Tab href="/employee/requests?tab=receipts" active={showReceipts} label="My receipts" />
      </div>

      {showReceipts ? (
        <>
          <div className="glass rounded-2xl p-4">
            <p className="text-xs font-medium uppercase tracking-wider text-ink/40">
              {periodLabel(period)}
            </p>
            <p className="mt-1 text-2xl font-semibold text-ink">{counted.toFixed(2)} JOD</p>
            <p className="mt-1 text-xs text-ink/50">
              {receipts.length} receipt{receipts.length === 1 ? "" : "s"} · each one counts up to{" "}
              {RECEIPT_CAP} JOD, added to this month&apos;s pay
            </p>
          </div>

          <ReceiptUploader />
          <ReceiptList receipts={receipts} />
        </>
      ) : (
        <>
          <SupplyRequestForm />
          <SupplyRequestList requests={requests} />
        </>
      )}
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
