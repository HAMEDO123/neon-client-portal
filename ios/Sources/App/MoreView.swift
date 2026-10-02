import SwiftUI

/// Everything the manager has beyond the four main tabs — the rest of the
/// admin portal's sidebar, as a beautiful grid of coloured destination tiles
/// instead of a plain list, grouped the way the sidebar groups them.
struct AdminMoreView: View {
    var body: some View {
        NavigationStack {
            NeonScroll(spacing: NeonSpace.stack) {
                ScreenHeader(L("More")) {
                    AccountMenu()
                }

                // Who is signed in, first — with their own face, which the
                // whole studio sees in chat, calls and stories.
                ManagerFaceCard()

                // Six tiles fill two full rows; the old five-tile "Team" card
                // left an empty sixth slot that read as a missing tile.
                MoreDestinationGroup(L("Work"), symbol: "briefcase.fill", hue: .blue) {
                    MoreDestinationTile(L("Reviews"), symbol: "tray.and.arrow.down.fill", hue: .orange) { ReviewsRootView() }
                    MoreDestinationTile(L("Requests"), symbol: "tray.full.fill", hue: .amber) { RequestsRootView() }
                    MoreDestinationTile(L("Alerts"), symbol: "bell.badge.fill", hue: .red) { AlertsRootView() }
                    MoreDestinationTile(L("Meetings"), symbol: "calendar", hue: .cyan) { MeetingsView() }
                    MoreDestinationTile(L("Site visits"), symbol: "mappin.and.ellipse", hue: .pink) { SiteVisitsRootView() }
                    MoreDestinationTile(L("WhatsApp"), symbol: "phone.bubble.fill", hue: .green) { WhatsAppRootView() }
                }

                MoreDestinationGroup(L("Team"), symbol: "person.2.fill", hue: .purple) {
                    MoreDestinationTile(L("Employees"), symbol: "person.2.fill", hue: .purple) { EmployeesRootView() }
                    MoreDestinationTile(L("Payroll"), symbol: "banknote.fill", hue: .green) { PayrollRootView() }
                    MoreDestinationTile(L("Attendance"), symbol: "clock.badge.checkmark.fill", hue: .indigo) { AttendanceRootView() }
                }

                // The office itself: where the team is, its cameras, how its
                // server and network are doing, and its shared shop cart.
                MoreDestinationGroup(L("The office"), symbol: "building.2.fill", hue: .green) {
                    MoreDestinationTile(L("Team map"), symbol: "map.fill", hue: .green) { TeamMapView() }
                    MoreDestinationTile(L("Cameras"), symbol: "video.fill", hue: .red) { CamerasRootView() }
                    MoreDestinationTile(L("Network & server"), symbol: "server.rack", hue: .cyan) { StatusRootView() }
                    MoreDestinationTile(L("Office shopping"), symbol: "cart.fill", hue: .green) { OfficeShoppingView() }
                }

                // Analytics and Settings each stood alone in a third,
                // near-empty card — they read better as plain rows on the
                // account card than as two tiles rattling around a grid.
                AccountCard {
                    MoreDestinationListRow(L("Analytics"), leading: .icon("chart.bar.fill", tint: .neonBlueStrong)) { AnalyticsRootView() }
                    NeonDivider()
                    MoreDestinationListRow(L("Settings"), leading: .icon("gearshape.fill", tint: .neonTextSecondary)) { SettingsRootView() }
                }
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

    /// How many of the three "given to you" destinations this person has.
    /// Three fills a grid row on its own; fewer left holes in it (and, before
    /// this, a whole "You" card held nothing but Profile in one third of its
    /// width), so 1–2 read better as plain rows than as a broken grid.
    private var givenToCount: Int {
        [permissions.canAssignTasks, permissions.canLogSiteVisits, permissions.canReadWhatsApp].filter { $0 }.count
    }

    var body: some View {
        NavigationStack {
            NeonScroll(spacing: NeonSpace.stack) {
                ScreenHeader(L("More")) {
                    AccountMenu()
                }

                MoreDestinationGroup(L("Your day"), symbol: "sparkles", hue: .indigo) {
                    MoreDestinationTile(L("Alerts"), symbol: "bell.badge.fill", hue: .red, badge: store.badges.unread) {
                        NotificationsView(openChat: openChat)
                    }
                    MoreDestinationTile(L("Meetings"), symbol: "calendar", hue: .cyan) { MeetingsView() }
                    MoreDestinationTile(L("My requests"), symbol: "tray.full.fill", hue: .amber) { MyRequestsRootView() }
                }

                if givenToCount == 3 {
                    MoreDestinationGroup(L("Given to you"), symbol: "hand.raised.fill", hue: .pink) {
                        MoreDestinationTile(L("Assign work"), symbol: "person.badge.plus", hue: .purple) { AssignRootView() }
                        MoreDestinationTile(L("Site visits"), symbol: "mappin.and.ellipse", hue: .pink) { SiteVisitsRootView() }
                        MoreDestinationTile(L("WhatsApp"), symbol: "phone.bubble.fill", hue: .green) { WhatsAppRootView() }
                    }
                }

                AccountCard {
                    MoreDestinationListRow(
                        api.identity?.name ?? L("Profile"),
                        subtitle: L("Profile, notifications, devices"),
                        leading: .avatar(url: facePhotoURL(api.myPhoto), name: api.identity?.name ?? L("Profile"))
                    ) { ProfileRootView() }

                    NeonDivider()
                    MoreDestinationListRow(L("Office shopping"), subtitle: L("Add what the office needs"), leading: .icon("cart.fill", tint: .neonSuccessStrong)) { OfficeShoppingView() }

                    if givenToCount > 0 && givenToCount < 3 {
                        if permissions.canAssignTasks {
                            NeonDivider()
                            MoreDestinationListRow(L("Assign work"), leading: .icon("person.badge.plus", tint: .neonPurpleStrong)) { AssignRootView() }
                        }
                        if permissions.canLogSiteVisits {
                            NeonDivider()
                            MoreDestinationListRow(L("Site visits"), leading: .icon("mappin.and.ellipse", tint: .neonPinkStrong)) { SiteVisitsRootView() }
                        }
                        if permissions.canReadWhatsApp {
                            NeonDivider()
                            MoreDestinationListRow(L("WhatsApp"), leading: .icon("phone.bubble.fill", tint: .neonSuccessStrong)) { WhatsAppRootView() }
                        }
                    }
                }
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

// MARK: - The manager's own face

/// The top of the manager's More tab: their own face, which they set here
/// the way somebody on the team sets theirs in Profile — the same control
/// (`FacePicker`: library, camera, Remove) and the same route, `me/photo`,
/// which the manager's token writes to the manager's own row. It is the face
/// the studio sees for "Manager" in every chat, call tile and story.
///
/// A studio with no row for the manager has nowhere to keep one; the card
/// says so plainly rather than offering a button the server would refuse.
private struct ManagerFaceCard: View {
    @EnvironmentObject var api: APIClient

    var body: some View {
        NeonCard {
            HStack(spacing: 14) {
                if api.canSetMyPhoto {
                    FacePicker(name: L("Manager"), photo: facePhotoURL(api.myPhoto)) { file in
                        try await api.setMyPhoto(file)
                    }
                } else {
                    AvatarView(url: nil, name: L("Manager"), size: 56, style: .solid)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Manager"))
                        .font(.neonTitle3)
                        .foregroundStyle(Color.neonInk)
                    Text(L("Your photo shows in chat, calls and stories"))
                        .font(.neonSubtitle)
                        .foregroundStyle(Color.neonTextSecondary)
                    Text(hint)
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextTertiary)
                }
                Spacer(minLength: 0)
            }
        }
        .neonAppear()
        // `/me` carries the face; the manager's side reads it nowhere else.
        .task { _ = try? await api.fetchMe() }
    }

    private var hint: String {
        if !api.canSetMyPhoto { return L("There is no employee record for the manager to keep a photo on.") }
        return api.myPhoto == nil ? L("Tap your picture to add a photo") : L("Tap your picture to change or remove it")
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
            // 12 apart, three to a row — the README's spacing for a grid this
            // wide, not the 8 pt a four-across grid gets.
            LazyVGrid(columns: [GridItem(.flexible(), spacing: NeonSpace.md), GridItem(.flexible(), spacing: NeonSpace.md), GridItem(.flexible())], spacing: NeonSpace.md) {
                content
            }
        }
    }
}

/// One coloured tile in the grid, pushing its destination — visually the
/// kit's `QuickActionTile`, wired to a `NavigationLink` instead of a tap
/// action so it can push a whole screen. Sized and set in the kit's own
/// figures (`NeonSize.iconTileLarge`, `.neonLabel`) so it doesn't drift from
/// Home's Quick Actions, which are built on the real thing.
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
                IconTile(symbol, hue: hue, size: NeonSize.iconTileLarge, style: .filled)
                    .overlay(alignment: .topTrailing) {
                        if badge > 0 { CountBadge(badge, size: 18).offset(x: 7, y: -7) }
                    }
                Text(title)
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonInk)
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

/// A destination that reads better as a plain row than a tile — a lone one,
/// or one of a handful that would otherwise leave a hole in a grid. Same
/// push-a-screen shape as `MoreDestinationTile`, drawn as a `ListRow`.
private struct MoreDestinationListRow<Destination: View>: View {
    let title: String
    var subtitle: String?
    var leading: RowLeading
    let destination: Destination

    init(_ title: String, subtitle: String? = nil, leading: RowLeading, @ViewBuilder destination: () -> Destination) {
        self.title = title
        self.subtitle = subtitle
        self.leading = leading
        self.destination = destination()
    }

    var body: some View {
        NavigationLink {
            destination
                .toolbar(.hidden, for: .tabBar)
        } label: {
            ListRow(title, subtitle: subtitle, leading: leading, chevron: true)
        }
        .buttonStyle(.pressable)
    }
}

/// Language and signing out, at the foot of both More tabs — plus, above
/// them, whatever few destinations this tab reads better as rows than tiles.
/// Built from the kit's own `ListRow`, matching the pastel-tile rows on the
/// rest of the page instead of a plain system `Label`.
private struct AccountCard<Extra: View>: View {
    @ViewBuilder let extra: () -> Extra

    @EnvironmentObject var api: APIClient
    @State private var confirmSignOut = false

    var body: some View {
        NeonCard {
            extra()

            NeonDivider()

            Button {
                Haptic.tap()
                AppLanguage.toggle()
            } label: {
                ListRow(AppLanguage.current == .arabic ? "English" : "العربية", leading: .icon("globe"), chevron: true)
            }
            .buttonStyle(.pressable)

            NeonDivider()

            Button(role: .destructive) {
                confirmSignOut = true
            } label: {
                ListRow(L("Sign Out"), leading: .icon("rectangle.portrait.and.arrow.right", tint: .neonDangerStrong))
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
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
    }
}
