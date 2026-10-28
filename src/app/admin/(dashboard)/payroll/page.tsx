import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Coins, FileSpreadsheet, Wallet } from "lucide-react";
import { prisma } from "@/lib/db";
import { getAllReceipts, getAttendanceForPeriod, getPayrollForPeriod } from "@/lib/payroll-queries";
import {
  setAttendance,
  setEmployeePay,
  correctReceipt,
  deleteAttendance,
  setDeviceUserId,
} from "@/lib/actions/operations-actions";
import { getTimezone } from "@/lib/settings";
import type { WorkedTotal } from "@/lib/attendance";
import { todayKey } from "@/lib/time";
import { isManagersFigure, periodLabel, periodOf, previousPeriod, RECEIPT_CAP } from "@/lib/payroll";
import { EmptyState } from "@/components/ui/empty-state";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { AttendanceDeviceCard } from "@/components/admin/attendance-device";
import { Cutoffs } from "@/components/admin/cutoffs";
import { deductionsForPeriod } from "@/lib/deduction-store";
import { CUTOFF_SETTING, cutoffOn } from "@/lib/task-cutoff";
import { getSetting } from "@/lib/settings";
import { formatDayIn } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
  const today = todayKey(timezone);

  // A month still being lived in is read differently from a closed one: what
  // has been cut so far is a running total, not a payslip. The wording says
  // which of the two is on screen.
  const isThisMonth = period === thisMonth;

  // Sequential for the same reason as the aggregates behind them.
  const rows = await getPayrollForPeriod(period);
  const attendance = await getAttendanceForPeriod(period);
  const receipts = await getAllReceipts();
  const deductions = await deductionsForPeriod(period);

  // One section per month, newest first — only the months that have any, so
  // the list is the studio's own history rather than a calendar.
  const receiptMonths = new Map<string, typeof receipts>();
  for (const receipt of receipts) {
    const key = receipt.periodMonth;
    receiptMonths.set(key, [...(receiptMonths.get(key) ?? []), receipt]);
  }
  const ruleOn = cutoffOn(await getSetting(CUTOFF_SETTING));
  const employees = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    orderBy: { order: "asc" },
    select: { id: true, name: true, deviceUserId: true },
  });

  // Somebody paid by the week has a row per week, so the team is the people in
  // the rows rather than the rows themselves.
  const team = new Set(rows.map((row) => row.employee.id)).size;
  // One form per person under Salaries, not one per week.
  const people = rows.filter((row, index) => rows.findIndex((other) => other.employee.id === row.employee.id) === index);

  const totals = rows.reduce(
    (sum, row) => ({
      cut: sum.cut + row.breakdown.totalCut,
      receipts: sum.receipts + row.breakdown.receiptTotal,
      final: sum.final + row.breakdown.finalPay,
    }),
    { cut: 0, receipts: 0, final: 0 }
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

        <div className="flex flex-wrap gap-2">
          {/* The working behind every figure on this page: each person's month
              a day at a time, printable, with the spreadsheet beside it. */}
          <Link
            href={`/admin/payroll/sheet?period=${period}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-cyan-strong/25 bg-cyan-50/70 px-4 py-2 text-xs font-medium text-cyan-900 hover:bg-cyan-50"
          >
            <FileSpreadsheet size={14} strokeWidth={2} />
            Month sheet
          </Link>
          <PeriodLink period={previousPeriod(period)} label="Previous month" />
          {!isThisMonth && <PeriodLink period={thisMonth} label="This month" />}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Team" value={String(team)} />
        <Stat
          label={isThisMonth ? "Deducted so far" : "Total deducted"}
          value={`${totals.cut.toFixed(2)} JOD`}
        />
        <Stat label="Receipts owed" value={`${totals.receipts.toFixed(2)} JOD`} />
        <Stat label="Total payable" value={`${totals.final.toFixed(2)} JOD`} />
      </div>

      {/* --- The pay sheet ------------------------------------------------ */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">Pay sheet</h2>
      {rows.some((row) => row.week) && (
        <p className="mt-1 text-xs text-ink/45">
          Paid by the week means a row per pay week — Tuesday to Monday — each with its own hours, cutoffs and
          receipts. A week that has not begun is not listed.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState className="mt-4" icon={Wallet} title="No employees yet" description="Add the team first." />
      ) : (
        <>
          {/* On a phone, a card per person: the table needs nine columns. */}
          <ul className="mt-4 flex flex-col gap-3 sm:hidden">
            {rows.map(({ employee, breakdown, delayDays, worked, week, receiptCount, adjustments }) => (
              <li key={`${employee.id}|${week?.key ?? period}`} className="glass rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{employee.name}</p>
                    {/* Paid weekly: the row is a week, and says which one. */}
                    {week ? (
                      <p className="text-xs text-ink/55">{week.label}</p>
                    ) : (
                      employee.role && <p className="text-xs text-ink/45">{employee.role}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[11px] text-ink/45">Final pay</p>
                    <p className="text-lg font-semibold tabular-nums text-ink">{breakdown.finalPay.toFixed(2)}</p>
                  </div>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-x-4">
                  <Line label="Salary">
                    {employee.salaryAmount == null ? (
                      <span className="text-xs text-amber-700">Not set</span>
                    ) : (
                      `${breakdown.salary.toFixed(2)} · ${breakdown.basis === "WEEKLY" ? "Weekly" : "Monthly"}`
                    )}
                  </Line>
                  <Line label="Per hour">{breakdown.hourlyRate.toFixed(3)}</Line>
                  <Line label="Worked">
                    <WorkedHours worked={worked} />
                  </Line>
                  <Line label="Late">
                    {breakdown.delayHours.toFixed(2)} h{delayDays > 0 && ` (${delayDays}d)`}
                  </Line>
                  <Line label="Left early">{breakdown.earlyHours.toFixed(2)} h</Line>
                  {breakdown.awayHours > 0 && <Line label="Stepped out">{breakdown.awayHours.toFixed(2)} h</Line>}
                  <Line label="Cutoff" className="text-red-600">
                    −{breakdown.cutoff.toFixed(2)}
                  </Line>
                  <Line
                    label="Adjustments"
                    className={breakdown.adjustmentTotal === 0 ? "text-ink/30" : "text-red-600"}
                  >
                    {breakdown.adjustmentTotal === 0 ? "—" : `−${breakdown.adjustmentTotal.toFixed(2)}`}
                  </Line>
                  <Line
                    label={isThisMonth ? "Cut so far" : "Total cut"}
                    className={breakdown.totalCut === 0 ? "text-ink/30" : "font-medium text-red-600"}
                  >
                    {breakdown.totalCut === 0 ? "—" : `−${breakdown.totalCut.toFixed(2)}`}
                  </Line>
                  <Line label="Receipts" className="text-emerald-700">
                    +{breakdown.receiptTotal.toFixed(2)}
                    {receiptCount > 0 && ` (${receiptCount})`}
                  </Line>
                </dl>

                {/* No hovering on a phone, so the reasons behind an adjustment are written out. */}
                {adjustments.length > 0 && (
                  <p className="mt-2 text-xs text-ink/50">{adjustments.map((a) => a.reason).join(" · ")}</p>
                )}
              </li>
            ))}
          </ul>

          <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-ink/8 sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink/[0.03] text-xs uppercase tracking-wider text-ink/40">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Salary</th>
                  <th className="px-4 py-3">Per hour</th>
                  <th className="px-4 py-3">Worked</th>
                  <th className="px-4 py-3">Late</th>
                  <th className="px-4 py-3">Left early</th>
                  <th className="px-4 py-3">Cutoff</th>
                  <th className="px-4 py-3">Adjustments</th>
                  <th className="px-4 py-3">{isThisMonth ? "Cut so far" : "Total cut"}</th>
                  <th className="px-4 py-3">Receipts</th>
                  <th className="px-4 py-3">Final pay</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee, breakdown, delayDays, worked, week, receiptCount, adjustments }) => (
                  <tr key={`${employee.id}|${week?.key ?? period}`} className="border-t border-ink/6">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{employee.name}</p>
                      {week ? (
                        <p className="text-xs text-ink/55">
                          {week.label}
                          {/* The one that changes on Tuesday. */}
                          {week.startKey <= today && today <= week.endKey && (
                            <span className="ml-1.5 rounded-full bg-cyan-50 px-1.5 py-0.5 text-[10px] font-medium text-cyan-800">
                              This week
                            </span>
                          )}
                        </p>
                      ) : (
                        employee.role && <p className="text-xs text-ink/45">{employee.role}</p>
                      )}
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
                    <td className="px-4 py-3 text-ink/70">
                      <WorkedHours worked={worked} />
                    </td>
                    <td className="px-4 py-3 text-ink/60">
                      {breakdown.delayHours.toFixed(2)} h
                      {delayDays > 0 && <span className="ml-1 text-xs text-ink/35">({delayDays}d)</span>}
                    </td>
                    <td className="px-4 py-3 text-ink/60">
                      {breakdown.earlyHours.toFixed(2)} h
                      {breakdown.awayHours > 0 && (
                        <span className="ml-1 text-xs text-ink/45">+ {breakdown.awayHours.toFixed(2)} h out</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-red-600">−{breakdown.cutoff.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {breakdown.adjustmentTotal === 0 ? (
                        <span className="text-ink/30">—</span>
                      ) : (
                        // The reason travels with the number: a deduction on a
                        // payslip that nobody can explain is a dispute waiting.
                        <span className="text-red-600" title={adjustments.map((a) => a.reason).join(" · ")}>
                          −{breakdown.adjustmentTotal.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {breakdown.totalCut === 0 ? (
                        <span className="text-ink/30">—</span>
                      ) : (
                        <span className="font-medium text-red-600">−{breakdown.totalCut.toFixed(2)}</span>
                      )}
                    </td>
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
        </>
      )}

      {/* --- Setting pay -------------------------------------------------- */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">Salaries</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        {people.map(({ employee }) => (
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
        Recorded per day and per person. The fingerprint device writes these same rows — and never writes over a
        figure you have typed here yourself.
      </p>

      <AttendanceDeviceCard
        pairedCount={employees.filter((employee) => employee.deviceUserId).length}
        teamCount={employees.length}
      />

      {/* Pairing is by the device's own user number, never by name: the device
          knows people by a number, the two lists of names rarely match, and a
          wrong pair deducts from the wrong person's pay with nothing on screen
          to say why. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {employees.map((employee) => (
          <form
            key={employee.id}
            action={setDeviceUserId.bind(null, employee.id)}
            className="flex items-center gap-2 rounded-xl border border-ink/8 bg-white/40 px-3 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{employee.name}</span>
            <input
              name="deviceUserId"
              defaultValue={employee.deviceUserId ?? ""}
              placeholder="device no."
              inputMode="numeric"
              aria-label={`Device number for ${employee.name}`}
              className="w-24 rounded-lg border border-ink/12 bg-white/70 px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
            />
            <SaveButton label="Pair" />
          </form>
        ))}
      </div>

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
        <label>
          <span className="mb-1 block text-xs font-medium text-ink/50">Hours left early</span>
          <input
            name="earlyHours"
            type="number"
            step="0.25"
            min="0"
            max="24"
            defaultValue="0"
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
                <th className="px-4 py-3">Left early</th>
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
                  <td className="px-4 py-3 text-ink/60">{record.earlyHours}</td>
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

      {/* --- Cutoffs ------------------------------------------------------ */}
      <Cutoffs
        team={employees.map((employee) => ({ id: employee.id, name: employee.name }))}
        ruleOn={ruleOn}
        thisMonth={isThisMonth}
        rows={deductions.map((row) => ({
          id: row.id,
          employeeName: row.employee.name,
          kind: row.kind,
          hours: row.hours,
          amount: row.amount,
          reason: row.reason,
          // A day, stored as that day's UTC midnight: read back in UTC so it
          // cannot slip to the evening before.
          dayLabel: formatDayIn("UTC", row.day) ?? "",
          cancelled: row.cancelledAt != null,
        }))}
      />

      {/* --- Receipts ----------------------------------------------------- */}
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">Receipts</h2>
      <p className="mt-1 text-xs text-ink/45">
        Read from the photo automatically. By itself a receipt counts up to {RECEIPT_CAP} JOD. To pay more or less
        for one, type the figure under &ldquo;Counts as&rdquo; — what you type is what is paid. Empty that box to go
        back to the usual rule.
      </p>

      {receipts.length === 0 ? (
        <EmptyState className="mt-4" icon={Coins} title="No receipts yet" />
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          {[...receiptMonths.entries()].map(([month, monthReceipts], index) => (
            // `details` rather than a state hook: this page is rendered on the
            // server, and a month that opens without JavaScript is one that
            // works before the page has finished loading. The newest is open,
            // because it is the month somebody came here for.
            <details
              key={month}
              open={index === 0}
              className="group rounded-2xl border border-ink/10 bg-white/40 open:bg-white/60"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 text-sm">
                <ChevronRight
                  size={14}
                  strokeWidth={2}
                  className="shrink-0 text-ink/30 transition-transform group-open:rotate-90"
                />
                <span className="font-medium text-ink">{periodLabel(month)}</span>
                <span className="text-xs text-ink/40">
                  {monthReceipts.length} {monthReceipts.length === 1 ? "receipt" : "receipts"}
                </span>
                <span className="ml-auto text-xs font-medium tabular-nums text-emerald-700">
                  {monthReceipts
                    .reduce((total, one) => total + (one.countedAmount ?? 0), 0)
                    .toFixed(2)}{" "}
                  JOD
                </span>
              </summary>

              <div className="flex flex-col gap-2 border-t border-ink/8 p-2">
          {monthReceipts.map((receipt) => (
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

              {/* Keyed on what is stored, so a save that changes a figure — "Counts
                  as" following a corrected amount — is drawn, not left as typed. */}
              <form
                key={`${receipt.vendor ?? ""}:${receipt.rawAmount ?? ""}:${receipt.countedAmount ?? ""}`}
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
                    step="any"
                    min="0"
                    defaultValue={receipt.rawAmount ?? ""}
                    className="w-24 rounded-lg border border-ink/12 bg-white/70 px-2 py-1.5 text-sm outline-none focus:border-cyan-strong"
                  />
                </label>
                {/* The manager's own figure, not held to the cap or to what was
                    paid. Opens holding what the receipt counts for now. */}
                <label>
                  <span className="mb-1 block text-[11px] font-medium text-ink/45">
                    Counts as{isManagersFigure(receipt.rawAmount, receipt.countedAmount) ? " · set by you" : ""}
                  </span>
                  <input
                    name="countedAmount"
                    type="number"
                    step="any"
                    min="0"
                    defaultValue={receipt.countedAmount ?? ""}
                    className="w-24 rounded-lg border border-emerald-600/25 bg-white/70 px-2 py-1.5 text-sm font-semibold text-emerald-700 outline-none focus:border-cyan-strong"
                  />
                </label>
                <SaveButton label="Save" />
              </form>
            </div>
          ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * How long somebody was actually at work this month.
 *
 * Three facts, and the two quiet ones matter as much as the figure: the days it
 * was added up from, and the days it could not be — an arrival with no
 * clock-out is an unknown, and a total silently missing one of those reads as
 * somebody who worked less than they did.
 */
function WorkedHours({ worked }: { worked: WorkedTotal }) {
  if (worked.days === 0 && worked.daysWithoutClockOut === 0) return <span className="text-ink/30">—</span>;

  return (
    <span>
      <span className="tabular-nums">{worked.hours.toFixed(2)} h</span>
      {worked.days > 0 && <span className="ml-1 text-xs text-ink/35">({worked.days}d)</span>}
      {/* There is no overtime, so hours past the eighth of a day are not paid.
          Said rather than dropped: the hours somebody gave the studio should
          not disappear off the only screen that counts them. */}
      {worked.onSite > worked.hours && (
        <span className="ml-1 text-xs text-ink/35">+{(worked.onSite - worked.hours).toFixed(2)} over</span>
      )}
      {worked.daysWithoutClockOut > 0 && (
        <span className="ml-1 text-xs text-amber-700" title="Arrived, no clock-out — those days are not in this total.">
          {worked.daysWithoutClockOut}d open
        </span>
      )}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  // Label first, the number under it, and tighter on a phone: four of these
  // filled the screen before the pay sheet itself.
  return (
    <div className="glass rounded-2xl p-3.5 sm:p-5">
      <p className="truncate text-[11px] font-medium text-ink/45 sm:text-xs">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tabular-nums text-ink sm:mt-2 sm:text-2xl">{value}</p>
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

function Line({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-ink/6 py-1.5">
      <dt className="text-xs text-ink/45">{label}</dt>
      <dd className={cn("text-sm tabular-nums", className ?? "text-ink/70")}>{children}</dd>
    </div>
  );
}
