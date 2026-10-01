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

## Faces
- [x] Employees list: each row draws the person's photo (`team/employees`
      `photoUrl`), initials where there is none.
- [x] Employee detail: the header *is* the face, and the manager changes it
      there — `FacePicker` (library, camera, Remove) through
      `team/employees/photo`, the website's own `setEmployeePhoto` behind
      `requireAdmin`. The manager's own row ("You · manager") works the same
      way and is the manager's own face everywhere, so saving it there also
      updates `APIClient.myPhoto`.
- [x] Payroll: pay-sheet rows and the device-pairing list draw faces
      (`team/payroll` rows' `employee.photoUrl`, its `employees`' `photoUrl`).
- [x] A face saved anywhere re-reads the list and payroll (`isFaceChange`).

## Kept out of scope, with reasons (see `notImplemented` in the run's report)
- The attendance *device* screen itself (sync now, pair by uid, wipe log,
  set clock) is `AttendanceRootView`, owned by the **ops** area per
  `ios/ARCHITECTURE.md` §3. This area only owns the `deviceUserId` pairing
  form that lives on the payroll page.
- [x] Tapping a sold project now pushes `ProjectDetailView(projectId:)`
  directly (a plain `NavigationLink(destination:)`, not the Projects tab's
  own `ProjectRoute`/`navigationDestination` pair — this screen lives in
  whichever stack hosts Team/More, not the Projects tab's stack, so the
  route type isn't registered there). Tapping the reviewer pushes another
  `EmployeeDetailView` via the existing `TeamEmployeeRoute`, which *is*
  registered on this stack (`EmployeesRootView`), so it resolves correctly
  however deep the reviewer chain goes.
- **Day-plan block editing still cannot reorder blocks or add one by
  hand.** Not a missed screen — the website's own action doesn't support
  it, and there is no way to add it without editing that shared action:
  `saveDayPlanEdits` (`src/lib/actions/day-plan-actions.ts`) takes
  `{ from: string; to: string; keep: boolean }[]`, refuses any length but
  `stored.blocks.length`, and maps `edits[index]` onto `stored.blocks[index]`
  by **array position** — never by an id or an order field. So an edits
  array sent back in a different order doesn't reorder anything: the server
  still walks `stored.blocks` in its stored order and only borrows each
  entry's `from`/`to`/`keep` from the same index of `edits`, which would
  quietly attach one block's time to a different block's task. And a longer
  array (an added block) is refused outright before any of that. The exact
  change needed: `saveDayPlanEdits` would need to accept a full
  `PlannedBlock[]` (order as sent, and a `what`/`why` for a hand-added
  block with no `entryId`) rather than a fixed-length, index-matched
  `{from,to,keep}[]`. That is a change to a shared server action file, so
  it stays out of this area's reach — reported rather than done.
