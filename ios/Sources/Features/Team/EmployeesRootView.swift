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
            SectionHeader(L("Team"), count: response.map { filtered($0.employees).count }) {
                IconButton("person.badge.plus", label: L("Add an employee"), look: .tinted, tint: .neonPurpleStrong) {
                    Haptic.tap()
                    showCreate = true
                }
            }

            LoadStateView(value: response, error: errorMessage, cachedAt: cachedAt, retry: load) { data in
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
                    CardList(shown) { employee in
                        NavigationLink(value: TeamEmployeeRoute(id: employee.id)) {
                            EmployeeSummaryRow(employee: employee, warningLimit: data.warningLimit)
                        }
                        .buttonStyle(.pressableCard)
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
        .sheet(isPresented: $showCreate) {
            CreateEmployeeSheet { await load() }
        }
        .task {
            if response == nil { await load() }
        }
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
        VStack(alignment: .leading, spacing: 8) {
            ListRow(
                employee.name,
                subtitle: employee.role,
                meta: employee.email ?? L("Board only — no login"),
                leading: .avatar(url: nil, name: employee.name),
                chevron: true
            )

            HStack(spacing: 6) {
                accountBadge
                if employee.warningCount > 0 {
                    BadgeView(text: L("%d/%d warnings", employee.warningCount, warningLimit), tone: .warning)
                }
                if employee.monthlySalesTarget > 0 {
                    BadgeView(
                        text: L("%d/%d sold", employee.sold, employee.monthlySalesTarget),
                        tone: employee.sold >= employee.monthlySalesTarget ? .success : .neutral
                    )
                }
                Spacer(minLength: 0)
                if employee.deviceCount > 0 {
                    MetaLabel(L("%d device", employee.deviceCount), symbol: "shield.checkerboard")
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 10)
        }
    }

    @ViewBuilder private var accountBadge: some View {
        if !employee.hasAccount {
            BadgeView(text: L("No account"), tone: .warning)
        } else {
            BadgeView(text: employee.active ? L("Active") : L("Disabled"), tone: employee.active ? .success : .neutral)
        }
    }
}

private struct CreateEmployeeSheet: View {
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
