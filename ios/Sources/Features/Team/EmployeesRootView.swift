import SwiftUI

/// Which employee is open — `NavigationLink(value:)` needs a `Hashable` route,
/// the same pattern `TaskRoute`/`ChatRoute` use elsewhere in the app.
struct TeamEmployeeRoute: Hashable {
    let id: String
}

/// Team accounts for the employee portal, mirroring
/// `src/app/admin/(dashboard)/employees/page.tsx`: everyone on the board, who
/// can sign in, warnings on record and this month's sales — with Add an
/// employee at the top.
struct EmployeesRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var response: TeamEmployeesResponse?
    @State private var errorMessage: String?
    @State private var cachedAt: Date?
    @State private var search = ""
    @State private var showCreate = false

    var body: some View {
        NeonScroll {
            LoadStateView(value: response, error: errorMessage, cachedAt: cachedAt, retry: load) { data in
                teamSummary(data.employees)

                if data.employees.count > 6 {
                    SearchField(text: $search, prompt: L("Search employees"))
                }

                let shown = filtered(data.employees)
                if shown.isEmpty {
                    EmptyState(
                        symbol: "person.2",
                        title: search.isEmpty ? L("No employees yet") : L("No matches"),
                        detail: search.isEmpty ? L("Add the first account above — they can then sign in to the employee portal.") : nil
                    )
                } else {
                    VStack(spacing: NeonSpace.stack) {
                        ForEach(shown) { employee in
                            NavigationLink(value: TeamEmployeeRoute(id: employee.id)) {
                                EmployeeSummaryRow(employee: employee, warningLimit: data.warningLimit)
                            }
                            .buttonStyle(.pressableCard)
                        }
                    }
                }
            }
        }
        .refreshable {
            Haptic.tap()
            await load()
        }
        .navigationTitle(L("Employees"))
        .navigationDestination(for: TeamEmployeeRoute.self) { route in
            EmployeeDetailView(employeeId: route.id)
        }
        .floatingActionButton("person.badge.plus", label: L("Add an employee")) {
            showCreate = true
        }
        .sheet(isPresented: $showCreate) {
            CreateEmployeeSheet { await load() }
        }
        .task {
            if response == nil { await load() }
        }
    }

    /// The team at a glance, above the list — real counts off what just
    /// loaded, never a figure invented for the sake of a fuller-looking row.
    ///
    /// "Team" here can read one higher than Payroll's own count: this read
    /// has no `accessRole` filter (unlike `team/payroll`'s, which asks only
    /// for `accessRole: "EMPLOYEE"`), so it counts the manager's own
    /// device-pairing row alongside the team. Fixing that at the root — so
    /// the two screens count exactly the same people — needs a change to
    /// the server read in `src/lib/mobile/registry/team.ts`, outside this
    /// area's editable files (see `ios/redesign/team.md`). Nothing here can
    /// tell that row apart from a real board-only employee (there is no
    /// `accessRole` in this response to test), so rather than leave the
    /// mismatch unexplained, the caption below says honestly why the two
    /// screens can disagree by one, instead of a silent, unexplained gap
    /// the manager would otherwise have to puzzle out on their own.
    @ViewBuilder
    private func teamSummary(_ employees: [TeamEmployeeSummary]) -> some View {
        let active = employees.filter { $0.hasAccount && $0.active }.count
        let warned = employees.filter { $0.warningCount > 0 }.count
        let noAccount = employees.filter { !$0.hasAccount }.count
        StatGrid(columns: 4) {
            KPICard(L("Team"), value: Double(employees.count), symbol: "person.2.fill", hue: .blue, density: .compact) { EmptyView() }
            KPICard(L("Active"), value: Double(active), symbol: "checkmark.seal.fill", hue: .green, density: .compact) { EmptyView() }
            KPICard(L("Warnings"), value: Double(warned), symbol: "exclamationmark.triangle.fill", hue: .orange, density: .compact) { EmptyView() }
            KPICard(L("No login"), value: Double(noAccount), symbol: "person.crop.circle.badge.questionmark", hue: .grey, density: .compact) { EmptyView() }
        }
        Text(L("\"Team\" here includes your own device-pairing account if you have one. Payroll never counts that row, so the two totals can differ by one."))
            .font(.neonCaption)
            .foregroundStyle(Color.neonTextTertiary)
    }

    private func filtered(_ employees: [TeamEmployeeSummary]) -> [TeamEmployeeSummary] {
        guard !search.isEmpty else { return employees }
        return employees.filter { matchesSearch(search, $0.name, $0.role, $0.email, $0.employeeCode) }
    }

    private func load() async {
        do {
            let loaded = try await api.read("team/employees", as: TeamEmployeesResponse.self)
            withNeonAnimation(NeonMotion.gentle) {
                response = loaded.value
                cachedAt = loaded.cachedAt
                errorMessage = nil
            }
        } catch {
            if response == nil { errorMessage = error.localizedDescription }
        }
    }
}

private struct EmployeeSummaryRow: View {
    let employee: TeamEmployeeSummary
    let warningLimit: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ListRow(
                employee.name,
                subtitle: employee.role ?? employee.email ?? L("Board only — no login"),
                leading: .avatar(url: nil, name: employee.name),
                value: soldText,
                badge: exceptionBadge?.text,
                badgeTone: exceptionBadge?.tone ?? .neutral,
                chevron: true
            )
            if employee.deviceCount > 0 {
                MetaLabel(deviceCountText, symbol: "iphone")
                    // Lines up with the name column, not under the avatar.
                    .padding(.leading, 64)
                    .padding(.bottom, 10)
            }
        }
        .rowCard()
    }

    /// Only what's out of the ordinary — an always-on ACTIVE badge on every
    /// row is noise the same way a smoke alarm going off every morning would
    /// be. At most one shown, worst first.
    private var exceptionBadge: (text: String, tone: BadgeTone)? {
        if !employee.hasAccount { return (L("No login"), .warning) }
        if !employee.active { return (L("Disabled"), .neutral) }
        if employee.warningCount > 0 { return (L("%d/%d warnings", employee.warningCount, warningLimit), .warning) }
        return nil
    }

    private var soldText: String? {
        guard employee.monthlySalesTarget > 0 else { return nil }
        return L("%d/%d sold", employee.sold, employee.monthlySalesTarget)
    }

    private var deviceCountText: String {
        teamPlural(employee.deviceCount, one: "%d device", other: "%d devices")
    }
}

// Not `private`: TeamScreens.swift opens it directly for screenshots.
struct CreateEmployeeSheet: View {
    var onCreated: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var role = ""
    @State private var phone = ""
    @State private var employeeCode = ""

    var body: some View {
        SheetScaffold(
            L("Add an employee"),
            subtitle: L("They sign in at the employee portal and see only their own tasks."),
            symbol: "person.badge.plus",
            primaryTitle: L("Create account"),
            isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty
        ) {
            await create()
        } content: {
            FormSection {
                NeonTextField(L("Full name"), text: $name, prompt: L("Ahmed Nasser"), symbol: "person", isRequired: true)
                NeonTextField(L("Email"), text: $email, prompt: "ahmed@company.com", symbol: "envelope", keyboard: .emailAddress, capitalization: .never, autocorrect: false, leftToRight: true)
                NeonTextField(L("Password"), text: $password, prompt: L("At least 8 characters"), symbol: "lock", isSecure: true, leftToRight: true)
                NeonTextField(L("Job title"), text: $role, prompt: L("3D Visualizer"), symbol: "briefcase")
                NeonTextField(L("Phone"), text: $phone, prompt: "+962 7 0000 0000", symbol: "phone", keyboard: .phonePad, leftToRight: true)
                NeonTextField(L("Employee ID"), text: $employeeCode, prompt: "NEON-014", symbol: "number", leftToRight: true)
            }
        }
        .neonSheet([.large])
    }

    private func create() async {
        do {
            try await api.perform("team/createEmployee", form: [
                "name": name,
                "email": email,
                "password": password,
                "role": role,
                "phone": phone,
                "employeeCode": employeeCode,
            ])
            Haptic.success()
            Toast.success(L("Account created"))
            dismiss()
            await onCreated()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}
