import Link from "next/link";
import { Coins, Wallet } from "lucide-react";
import { prisma } from "@/lib/db";
import { getAttendanceForPeriod, getPayrollForPeriod, getReceiptsForPeriod } from "@/lib/payroll-queries";
import { setAttendance, setEmployeePay, correctReceipt, deleteAttendance } from "@/lib/actions/operations-actions";
import { getTimezone } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { periodLabel, periodOf, previousPeriod, RECEIPT_CAP } from "@/lib/payroll";
import { EmptyState } from "@/components/ui/empty-state";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { Badge } from "@/components/ui/badge";

// The month's pay sheet: what each person earns, how late they were, what
// they are owed back, and what that leaves. The arithmetic is in payroll.ts.

export default async function AdminPayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: requested } = await searchParams;
  const timezone = await getTimezone();
  const thisMonth = periodOf(todayKey(timezone));

  const period = /^\d{4}-\d{2}$/.test(requested ?? "") ? requested! : thisMonth;

  const [rows, attendance, receipts, employees] = await Promise.all([
    getPayrollForPeriod(period),
    getAttendanceForPeriod(period),
    getReceiptsForPeriod(period),
    prisma.employee.findMany({
      where: { active: true, accessRole: "EMPLOYEE" },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const totals = rows.reduce(
    (sum, row) => ({
      cutoff: sum.cutoff + row.breakdown.cutoff,
      receipts: sum.receipts + row.breakdown.receiptTotal,
      final: sum.final + row.breakdown.finalPay,
    }),
    { cutoff: 0, receipts: 0, final: 0 }
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Payroll</h1>
          <p className="mt-1 text-sm text-ink/50">
            {periodLabel(period)} · salary ÷ working days ÷ 8 gives the hourly rate, times the hours late is the
            cutoff, plus receipts.
          </p>
        </div>

        <div className="flex gap-2">
          <PeriodLink period={previousPeriod(period)} label="Previous month" />
          {period !== thisMonth && <PeriodLink period={thisMonth} label="This month" />}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Team" value={String(rows.length)} />
        <Stat label="Total cutoff" value={`${totals.cutoff.toFixed(2)} JOD`} />
        <Stat label="Receipts owed" value={`${totals.receipts.toFixed(2)} JOD`} />
        <Stat label="Total payable" value={`${totals.final.toFixed(2)} JOD`} />
      </div>

      {/* --- The pay sheet ------------------------------------------------ */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">Pay sheet</h2>

      {rows.length === 0 ? (
        <EmptyState className="mt-4" icon={Wallet} title="No employees yet" description="Add the team first." />
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/8">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink/[0.03] text-xs uppercase tracking-wider text-ink/40">
              <tr>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Salary</th>
                <th className="px-4 py-3">Per hour</th>
                <th className="px-4 py-3">Late</th>
                <th className="px-4 py-3">Cutoff</th>
                <th className="px-4 py-3">Receipts</th>
                <th className="px-4 py-3">Final pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ employee, breakdown, delayDays, receiptCount }) => (
                <tr key={employee.id} className="border-t border-ink/6">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{employee.name}</p>
                    {employee.role && <p className="text-xs text-ink/45">{employee.role}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {employee.salaryAmount == null ? (
                      <span className="text-xs text-amber-700">Not set</span>
                    ) : (
                      <>
                        <span className="text-ink/70">{breakdown.salary.toFixed(2)}</span>
                        <Badge tone="neutral" className="ml-2">
                          {breakdown.basis === "WEEKLY" ? "Weekly" : "Monthly"}
                        </Badge>
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink/60">{breakdown.hourlyRate.toFixed(3)}</td>
                  <td className="px-4 py-3 text-ink/60">
                    {breakdown.delayHours.toFixed(2)} h
                    {delayDays > 0 && <span className="ml-1 text-xs text-ink/35">({delayDays}d)</span>}
                  </td>
                  <td className="px-4 py-3 text-red-600">−{breakdown.cutoff.toFixed(2)}</td>
                  <td className="px-4 py-3 text-emerald-700">
                    +{breakdown.receiptTotal.toFixed(2)}
                    {receiptCount > 0 && <span className="ml-1 text-xs text-ink/35">({receiptCount})</span>}
                  </td>
                  <td className="px-4 py-3 font-semibold text-ink">{breakdown.finalPay.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --- Setting pay -------------------------------------------------- */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">Salaries</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {rows.map(({ employee }) => (
          <form
            key={employee.id}
            action={setEmployeePay.bind(null, employee.id)}
            className="glass flex flex-wrap items-end gap-3 rounded-2xl p-4"
          >
            <p className="w-full text-sm font-medium text-ink">{employee.name}</p>
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium text-ink/50">Salary (JOD)</span>
              <input
                name="salaryAmount"
                type="number"
                step="0.01"
                min="0"
                defaultValue={employee.salaryAmount ?? ""}
                className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-ink/50">Paid</span>
              <select
                name="payBasis"
                defaultValue={employee.payBasis}
                className="rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
              >
                <option value="MONTHLY">Monthly (÷26÷8)</option>
                <option value="WEEKLY">Weekly (÷6÷8)</option>
              </select>
            </label>
            <SaveButton label="Save" />
          </form>
        ))}
      </div>

      {/* --- Attendance --------------------------------------------------- */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">Arrival delays</h2>
      <p className="mt-1 text-xs text-ink/45">
        Recorded per day and per person. The attendance device can write these same rows later without changing
        anything here.
      </p>

      <form action={setAttendance} className="glass mt-4 flex flex-wrap items-end gap-3 rounded-2xl p-5">
        <label className="min-w-40 flex-1">
          <span className="mb-1 block text-xs font-medium text-ink/50">Employee</span>
          <select
            name="employeeId"
            required
            className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          >
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink/50">Day</span>
          <input
            name="day"
            type="date"
            required
            defaultValue={todayKey(timezone)}
            className="rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-ink/50">Hours late</span>
          <input
            name="delayHours"
            type="number"
            step="0.25"
            min="0"
            max="24"
            defaultValue="1"
            className="w-28 rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </label>
        <label className="min-w-40 flex-1">
          <span className="mb-1 block text-xs font-medium text-ink/50">Note</span>
          <input
            name="note"
            className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
        </label>
        <SaveButton label="Record" />
      </form>

      {attendance.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/8">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink/[0.03] text-xs uppercase tracking-wider text-ink/40">
              <tr>
                <th className="px-4 py-3">Day</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Hours late</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {attendance.map((record) => (
                <tr key={record.id} className="border-t border-ink/6">
                  <td className="px-4 py-3 text-ink/60">{record.day.toISOString().slice(0, 10)}</td>
                  <td className="px-4 py-3 font-medium text-ink">{record.employee.name}</td>
                  <td className="px-4 py-3 text-ink/60">{record.delayHours}</td>
                  <td className="px-4 py-3 text-xs text-ink/45">{record.note ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <form>
                      <DeleteButton
                        formAction={deleteAttendance.bind(null, record.id)}
                        label="Remove"
                        confirmMessage="Remove this delay record?"
                      />
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --- Receipts ----------------------------------------------------- */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">
        Receipts · {periodLabel(period)}
      </h2>
      <p className="mt-1 text-xs text-ink/45">
        Read from the photo automatically. Each receipt counts up to {RECEIPT_CAP} JOD — correct the amount here if
        the reading is wrong.
      </p>

      {receipts.length === 0 ? (
        <EmptyState className="mt-4" icon={Coins} title="No receipts this month" />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {receipts.map((receipt) => (
            <div key={receipt.id} className="glass flex flex-wrap items-center gap-4 rounded-2xl p-3">
              <a href={receipt.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receipt.imageUrl} alt="Receipt" className="h-16 w-14 rounded-lg object-cover" />
              </a>

              <div className="min-w-40 flex-1">
                <p className="text-sm font-medium text-ink">{receipt.employee.name}</p>
                <p className="text-xs text-ink/50">
                  {receipt.summary ?? receipt.aiNotes ?? "No description"}
                </p>
              </div>

              <form
                action={correctReceipt.bind(null, receipt.id)}
                className="flex flex-wrap items-end gap-2"
              >
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-ink/45">Vendor</span>
                  <input
                    name="vendor"
                    defaultValue={receipt.vendor ?? ""}
                    className="w-36 rounded-lg border border-ink/12 bg-white/70 px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-ink/45">Paid</span>
                  <input
                    name="rawAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={receipt.rawAmount ?? ""}
                    className="w-24 rounded-lg border border-ink/12 bg-white/70 px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
                  />
                </label>
                <div className="pb-1.5">
                  <p className="text-[11px] text-ink/45">Counts as</p>
                  <p className="text-sm font-semibold text-emerald-700">
                    {(receipt.countedAmount ?? 0).toFixed(2)}
                  </p>
                </div>
                <SaveButton label="Fix" />
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink/50">{label}</p>
    </div>
  );
}

function PeriodLink({ period, label }: { period: string; label: string }) {
  return (
    <Link
      href={`/admin/payroll?period=${period}`}
      className="rounded-full border border-ink/12 bg-white/60 px-4 py-2 text-xs font-medium text-ink/60 hover:text-ink"
    >
      {label}
    </Link>
  );
}
