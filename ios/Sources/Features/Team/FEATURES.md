# Team area — feature inventory

Source of truth read: `src/app/admin/(dashboard)/employees/page.tsx`,
`employees/[id]/page.tsx`, `payroll/page.tsx` and the components/lib they use
(`employee-warnings.tsx`, `employee-sales.tsx`, `performance-card.tsx`,
`day-plan-panel.tsx`, `lib/payroll.ts`, `lib/performance.ts`, `lib/sales.ts`,
`lib/warnings.ts`, `lib/day-plan*.ts`, `lib/actions/admin-employee-actions.ts`,
`warning-actions.ts`, `day-plan-actions.ts`, `operations-actions.ts`
(payroll-related exports only)).

## Employees list (`EmployeesRootView`)
- [x] Every employee, active first then by board order
- [x] Search (name, role, email, employee code)
- [x] Account badge: No account / Active / Disabled
- [x] Warnings badge (n/limit) when any are on record
- [x] Sales badge (sold/target) when a target is set
- [x] Board-only note ("no login") when there is no email
- [x] Device count
- [x] Add an employee (name, email, password, role, phone, employee ID)
- [x] Push to an employee's detail page

## Employee detail (`EmployeeDetailView`)
- [x] Header: name, active/disabled, no-account badge, added/last-signed-in
- [x] Account fields (email, phone, employee ID, sales target, reviewer)
- [x] Permission ticks: WhatsApp, assign tasks, site visits (shown + editable)
- [x] "What they usually do" shown on the page; full playbook/skills/examples/
      capacity/reviewer editable in the Edit sheet
- [x] Day plan panel: today/tomorrow switch, generate, edit (tick + time),
      save, apply, notes, "on the board" state
- [x] Sales this month: progress bar, standing line, sold projects list
- [x] Performance: five indicators (on time, accepted first time, rework,
      waiting on blockers, estimates), sample-size refusal with the reason —
      never presence/hours
- [x] Warnings: standing dots, list with reasons and dates, give (with the
      final-warning wording and confirm), remove (with confirm)
- [x] Account access: enable/disable (confirm to disable), set a new
      password, revoke login (email accounts only, confirm), device/
      notification counts

## Payroll (`PayrollRootView`)
- [x] Period switch (previous month / this month), period label
- [x] Totals: team size, deducted (so-far/total wording), receipts owed,
      total payable
- [x] Pay sheet: salary, hourly rate, late hours, cutoff, adjustments (with
      reasons), total cut, receipts, final pay — one card per person
- [x] Salaries: edit each person's amount and pay basis (monthly/weekly)
- [x] Arrival delays: record (employee, day, hours, note), list, remove
- [x] Fingerprint device pairing by device user number (not by name)
- [x] Receipts: list with photo, summary, counted amount; correct vendor/
      amount in a sheet

## Kept out of scope, with reasons (see `notImplemented` in the run's report)
- The attendance *device* screen itself (sync now, pair by uid, wipe log,
  set clock) is `AttendanceRootView`, owned by the **ops** area per
  `ios/ARCHITECTURE.md` §3. This area only owns the `deviceUserId` pairing
  form that lives on the payroll page.
- Tapping a sold project or the reviewer does not push into that project's
  or colleague's own page — those are the **projects** area's screens and
  there is no cross-area route contract for them yet. Shown read-only.
- Day-plan block editing changes times and the keep tick; it does not let
  the manager reorder blocks or add a new one by hand — the web panel
  doesn't offer that either.
