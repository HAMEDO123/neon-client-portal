import SwiftUI

/// Everything the manager has beyond the four main tabs — the rest of the
/// admin portal's sidebar, as a beautiful grid of coloured destination tiles
/// instead of a plain list, grouped the way the sidebar groups them.
struct AdminMoreView: View {
    var body: some View {
        NavigationStack {
            NeonScroll(spacing: NeonSpace.stack) {
                ScreenHeader(L("More"), subtitle: L("Signed in as the manager")) {
                    AccountMenu()
                }

                MoreDestinationGroup(L("Work"), symbol: "briefcase.fill", hue: .blue) {
                    MoreDestinationTile(L("Reviews"), symbol: "checkmark.seal.fill", hue: .purple) { ReviewsRootView() }
                    MoreDestinationTile(L("Meetings"), symbol: "calendar", hue: .cyan) { MeetingsView() }
                    MoreDestinationTile(L("Alerts"), symbol: "bell.fill", hue: .orange) { AlertsRootView() }
                }

                MoreDestinationGroup(L("Team"), symbol: "person.2.fill", hue: .purple) {
                    MoreDestinationTile(L("Employees"), symbol: "person.2.fill", hue: .purple) { EmployeesRootView() }
                    MoreDestinationTile(L("Payroll"), symbol: "banknote.fill", hue: .green) { PayrollRootView() }
                    MoreDestinationTile(L("Attendance"), symbol: "clock.badge.checkmark.fill", hue: .cyan) { AttendanceRootView() }
                    MoreDestinationTile(L("Requests"), symbol: "tray.full.fill", hue: .orange) { RequestsRootView() }
                    MoreDestinationTile(L("Site visits"), symbol: "mappin.and.ellipse", hue: .pink) { SiteVisitsRootView() }
                }

                MoreDestinationGroup(L("Studio"), symbol: "building.2.fill", hue: .indigo) {
                    MoreDestinationTile(L("Analytics"), symbol: "chart.bar.xaxis", hue: .cyan) { AnalyticsRootView() }
                    MoreDestinationTile(L("WhatsApp"), symbol: "phone.bubble.fill", hue: .green) { WhatsAppRootView() }
                    MoreDestinationTile(L("Settings"), symbol: "gearshape.fill", hue: .grey) { SettingsRootView() }
                }

                AccountCard()
            }
            .toolbar(.hidden, for: .navigationBar)
            .neonAmbientBackground()
        }
    }
}

/// The team's More tab: the portal's other destinations, and the three that
/// only exist for somebody the manager has ticked for them — a colourful
/// grid, exactly as the manager's own More tab now reads.
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

    private var hasGivenTo: Bool {
        permissions.canAssignTasks || permissions.canLogSiteVisits || permissions.canReadWhatsApp
    }

    var body: some View {
        NavigationStack {
            NeonScroll(spacing: NeonSpace.stack) {
                ScreenHeader(L("More"), subtitle: api.identity.map { L("Signed in as %@", $0.name) }) {
                    AccountMenu()
                }

                MoreDestinationGroup(L("Your day"), symbol: "sparkles", hue: .indigo) {
                    MoreDestinationTile(L("Alerts"), symbol: "bell.fill", hue: .orange, badge: store.badges.unread) {
                        NotificationsView(openChat: openChat)
                    }
                    MoreDestinationTile(L("Meetings"), symbol: "calendar", hue: .cyan) { MeetingsView() }
                    MoreDestinationTile(L("My requests"), symbol: "tray.full.fill", hue: .purple) { MyRequestsRootView() }
                }

                if hasGivenTo {
                    MoreDestinationGroup(L("Given to you"), symbol: "hand.raised.fill", hue: .pink) {
                        if permissions.canAssignTasks {
                            MoreDestinationTile(L("Assign work"), symbol: "person.badge.plus", hue: .purple) { AssignRootView() }
                        }
                        if permissions.canLogSiteVisits {
                            MoreDestinationTile(L("Site visits"), symbol: "mappin.and.ellipse", hue: .pink) { SiteVisitsRootView() }
                        }
                        if permissions.canReadWhatsApp {
                            MoreDestinationTile(L("WhatsApp"), symbol: "phone.bubble.fill", hue: .green) { WhatsAppRootView() }
                        }
                    }
                }

                MoreDestinationGroup(L("You"), symbol: "person.fill", hue: .grey) {
                    MoreDestinationTile(L("Profile"), symbol: "person.crop.circle.fill", hue: .indigo) { ProfileRootView() }
                }

                AccountCard()
            }
            .toolbar(.hidden, for: .navigationBar)
            .neonAmbientBackground()
            .task {
                if let loaded = try? await api.read("me/permissions", as: Permissions.self) {
                    permissions = loaded.value
                }
            }
        }
    }
}

// MARK: - Destination grid

/// A `SectionCard` holding a grid of coloured destination tiles — the same
/// shape as the mockups' Quick Actions block, reused as this tab's whole
/// layout. The kit's `QuickActionGrid` only takes a tap action, not a screen
/// to push, so this area builds its own tile that pushes a `NavigationLink`
/// instead (see `MoreDestinationTile` below; reported under kitRequests).
private struct MoreDestinationGroup<Content: View>: View {
    let title: String
    let symbol: String
    let hue: NeonHue
    let content: Content

    init(_ title: String, symbol: String, hue: NeonHue, @ViewBuilder content: () -> Content) {
        self.title = title
        self.symbol = symbol
        self.hue = hue
        self.content = content()
    }

    var body: some View {
        SectionCard(title, symbol: symbol, hue: hue) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: NeonSpace.sm), GridItem(.flexible(), spacing: NeonSpace.sm), GridItem(.flexible())], spacing: NeonSpace.sm) {
                content
            }
        }
    }
}

/// One coloured tile in the grid, pushing its destination — visually the
/// kit's `QuickActionTile`, wired to a `NavigationLink` instead of a tap
/// action so it can push a whole screen.
private struct MoreDestinationTile<Destination: View>: View {
    let title: String
    let symbol: String
    let hue: NeonHue
    var badge: Int
    let destination: Destination

    init(_ title: String, symbol: String, hue: NeonHue, badge: Int = 0, @ViewBuilder destination: () -> Destination) {
        self.title = title
        self.symbol = symbol
        self.hue = hue
        self.badge = badge
        self.destination = destination()
    }

    var body: some View {
        NavigationLink {
            destination
                .toolbar(.hidden, for: .tabBar)
        } label: {
            VStack(spacing: 9) {
                IconTile(symbol, hue: hue, size: 42, style: .filled)
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 { CountBadge(badge, size: 18).offset(x: 7, y: -7) }
                    }
                Text(title)
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.neonInk.opacity(0.88))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, minHeight: 100)
            .background {
                let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
                shape.fill(LinearGradient(colors: [hue.wash.opacity(0.7), hue.wash], startPoint: .top, endPoint: .bottom))
                    .overlay(shape.strokeBorder(hue.color.opacity(0.08), lineWidth: 1))
            }
            .contentShape(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous))
        }
        .buttonStyle(.pressableCard)
        .accessibilityLabel(Text(badge > 0 ? L("%@, %d new", title, badge) : title))
    }
}

/// Language and signing out, at the foot of both More tabs.
private struct AccountCard: View {
    @EnvironmentObject var api: APIClient
    @State private var confirmSignOut = false

    var body: some View {
        NeonCard {
            Button {
                Haptic.tap()
                AppLanguage.toggle()
            } label: {
                HStack {
                    Label(AppLanguage.current == .arabic ? "English" : "العربية", systemImage: "globe")
                        .font(.system(.subheadline, weight: .medium))
                        .foregroundStyle(Color.neonInk)
                    Spacer()
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.neonTextFaint)
                }
            }
            .buttonStyle(.pressable)

            NeonDivider()

            Button(role: .destructive) {
                confirmSignOut = true
            } label: {
                HStack {
                    Label(L("Sign Out"), systemImage: "rectangle.portrait.and.arrow.right")
                        .font(.system(.subheadline, weight: .medium))
                        .foregroundStyle(Color.neonDangerStrong)
                    Spacer()
                }
            }
            .buttonStyle(.pressable)
            .confirmationDialog(L("Sign out of NEON?"), isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button(L("Sign Out"), role: .destructive) { api.logout() }
                Button(L("Cancel"), role: .cancel) {}
            }

            if let identity = api.identity {
                Text(identity.side == .admin ? L("Signed in as the manager") : L("Signed in as %@", identity.name))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
    }
}
