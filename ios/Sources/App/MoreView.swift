import SwiftUI

/// Everything the manager has beyond the four main tabs — the rest of the
/// admin portal's sidebar, one row each.
struct AdminMoreView: View {
    var body: some View {
        NavigationStack {
            List {
                Section(L("Work")) {
                    MoreRow(L("Reviews"), symbol: "checkmark.seal", tint: .neonPurpleStrong) { ReviewsRootView() }
                    MoreRow(L("Meetings"), symbol: "calendar", tint: .neonCyanStrong) { MeetingsView() }
                    MoreRow(L("Alerts"), symbol: "bell", tint: .neonOrangeStrong) { AlertsRootView() }
                }
                Section(L("Team")) {
                    MoreRow(L("Employees"), symbol: "person.2", tint: .neonPurpleStrong) { EmployeesRootView() }
                    MoreRow(L("Payroll"), symbol: "banknote", tint: .green) { PayrollRootView() }
                    MoreRow(L("Attendance"), symbol: "clock.badge.checkmark", tint: .neonCyanStrong) { AttendanceRootView() }
                    MoreRow(L("Requests"), symbol: "tray.full", tint: .neonOrangeStrong) { RequestsRootView() }
                    MoreRow(L("Site visits"), symbol: "mappin.and.ellipse", tint: .neonPinkStrong) { SiteVisitsRootView() }
                }
                Section(L("Studio")) {
                    MoreRow(L("Analytics"), symbol: "chart.bar.xaxis", tint: .neonCyanStrong) { AnalyticsRootView() }
                    MoreRow(L("WhatsApp"), symbol: "phone.bubble", tint: .green) { WhatsAppRootView() }
                    MoreRow(L("Settings"), symbol: "gearshape", tint: .neonInk) { SettingsRootView() }
                }
                AccountSection()
            }
            .navigationTitle(L("More"))
        }
    }
}

/// The team's More tab: the portal's other destinations, and the three that
/// only exist for somebody the manager has ticked for them.
struct EmployeeMoreView: View {
    var openChat: () -> Void = {}

    @EnvironmentObject var api: APIClient
    @EnvironmentObject var store: StaffStore
    @State private var permissions = Permissions()

    struct Permissions: Decodable {
        var canReadWhatsApp = false
        var canAssignTasks = false
        var canLogSiteVisits = false
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    MoreRow(L("Alerts"), symbol: "bell", tint: .neonOrangeStrong, badge: store.badges.unread) {
                        NotificationsView(openChat: openChat)
                    }
                    MoreRow(L("Meetings"), symbol: "calendar", tint: .neonCyanStrong) { MeetingsView() }
                    MoreRow(L("My requests"), symbol: "tray.full", tint: .neonPurpleStrong) { MyRequestsRootView() }
                }
                if permissions.canAssignTasks || permissions.canLogSiteVisits || permissions.canReadWhatsApp {
                    Section(L("Given to you")) {
                        if permissions.canAssignTasks {
                            MoreRow(L("Assign work"), symbol: "person.badge.plus", tint: .neonPurpleStrong) { AssignRootView() }
                        }
                        if permissions.canLogSiteVisits {
                            MoreRow(L("Site visits"), symbol: "mappin.and.ellipse", tint: .neonPinkStrong) { SiteVisitsRootView() }
                        }
                        if permissions.canReadWhatsApp {
                            MoreRow(L("WhatsApp"), symbol: "phone.bubble", tint: .green) { WhatsAppRootView() }
                        }
                    }
                }
                Section {
                    MoreRow(L("Profile"), symbol: "person.crop.circle", tint: .neonInk) { ProfileRootView() }
                }
                AccountSection()
            }
            .navigationTitle(L("More"))
            .task {
                if let loaded = try? await api.read("me/permissions", as: Permissions.self) {
                    permissions = loaded.value
                }
            }
        }
    }
}

struct MoreRow<Destination: View>: View {
    let title: String
    let symbol: String
    let tint: Color
    var badge = 0
    @ViewBuilder let destination: () -> Destination

    init(_ title: String, symbol: String, tint: Color, badge: Int = 0, @ViewBuilder destination: @escaping () -> Destination) {
        self.title = title
        self.symbol = symbol
        self.tint = tint
        self.badge = badge
        self.destination = destination
    }

    var body: some View {
        NavigationLink {
            destination()
                .toolbar(.hidden, for: .tabBar)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 30, height: 30)
                    .background(tint.gradient, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                Text(title)
                    .font(.system(size: 16))
                Spacer()
                if badge > 0 {
                    Text("\(badge)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .frame(minHeight: 22)
                        .background(Color.red, in: Capsule())
                }
            }
        }
    }
}

/// Language and signing out, at the foot of both More tabs.
struct AccountSection: View {
    @EnvironmentObject var api: APIClient
    @State private var confirmSignOut = false

    var body: some View {
        Section {
            Button {
                Haptic.tap()
                AppLanguage.toggle()
            } label: {
                Label(AppLanguage.current == .arabic ? "English" : "العربية", systemImage: "globe")
            }
            Button(role: .destructive) {
                confirmSignOut = true
            } label: {
                Label(L("Sign Out"), systemImage: "rectangle.portrait.and.arrow.right")
            }
            .confirmationDialog(L("Sign out of NEON?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button(L("Sign Out"), role: .destructive) { api.logout() }
                Button(L("Cancel"), role: .cancel) {}
            }
        } footer: {
            if let identity = api.identity {
                Text(identity.side == .admin ? L("Signed in as the manager") : L("Signed in as %@", identity.name))
            }
        }
    }
}
