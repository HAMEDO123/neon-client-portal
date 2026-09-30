import SwiftUI

/// One employee's page: account details, a proposed day, this month's sales,
/// how the work is going, warnings, and account access — mirrors
/// `src/app/admin/(dashboard)/employees/[id]/page.tsx`.
struct EmployeeDetailView: View {
    let employeeId: String

    @EnvironmentObject var api: APIClient
    @State private var response: TeamEmployeeResponse?
    @State private var errorMessage: String?
    @State private var cachedAt: Date?
    @State private var showEdit = false
    @State private var showPasswordReset = false
    @State private var playbookExpanded = false
    /// The face just saved here, ahead of the next read — `.some(nil)` after
    /// a removal.
    @State private var savedPhoto: String??

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll {
                LoadStateView(value: response, error: errorMessage, cachedAt: cachedAt, retry: load) { data in
                    header(data).id("profile")

                    DayPlanCard(
                        employeeId: employeeId,
                        name: data.employee.name,
                        today: data.today,
                        tomorrow: data.tomorrow,
                        tomorrowLabel: data.tomorrowLabel,
                        aiConfigured: data.aiConfigured,
                        initialPlans: data.plans
                    )
                    .id("day-plan")

                    salesCard(data.sales).id("sales")
                    performanceCard(data.performance, days: data.performanceDays).id("performance")
                    warningsCard(data).id("warnings")
                    accountAccessCard(data).id("access")
                    playbookCard(data.employee).id("playbook")
                }
            }
            #if DEBUG
            .debugScroll(proxy)
            #endif
        }
        .refreshable {
            Haptic.tap()
            await load()
        }
        .navigationTitle(response?.employee.name ?? L("Employee"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                IconButton("pencil", label: L("Edit"), look: .tinted) {
                    Haptic.tap()
                    showEdit = true
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            if let data = response {
                EditEmployeeSheet(employeeId: employeeId, employee: data.employee, colleagues: data.colleagues) {
                    await load()
                }
            }
        }
        .sheet(isPresented: $showPasswordReset) {
            ResetPasswordSheet(employeeId: employeeId)
        }
        .task {
            if response == nil { await load() }
        }
    }

    // MARK: - Header + details

    @ViewBuilder
    private func header(_ data: TeamEmployeeResponse) -> some View {
        HeroHeader(data.employee.name, subtitle: data.employee.role, eyebrow: L("Employee"), symbol: "person.fill", tint: NeonPalette.color(for: data.employee.name), height: 168) {
            HStack(spacing: 8) {
                BadgeView(text: data.employee.active ? L("Active") : L("Disabled"), tone: data.employee.active ? .success : .neutral)
                if data.employee.email == nil { BadgeView(text: L("No account"), tone: .warning) }
            }
        }
        .heroLeading {
            // Their face, which the manager can change here — the same
            // control somebody uses on their own profile, writing through
            // `team/employees/photo` (the website's own `setEmployeePhoto`,
            // behind `requireAdmin`). They can still change it themselves.
            FacePicker(name: data.employee.name, photo: facePhotoURL(savedPhoto ?? data.employee.photoUrl), size: 64) { file in
                let url = try await api.setEmployeePhoto(employeeId: employeeId, file)
                savedPhoto = .some(url)
                // The manager's own row is the manager's own face everywhere.
                if data.employee.accessRole == "MANAGER" { api.noteOwnPhoto(url) }
            }
        }

        NeonCard {
            HStack(spacing: 12) {
                MetaLabel(L("Added %@", dateOnly(data.employee.createdAt) ?? ""), symbol: "calendar")
                Spacer(minLength: 8)
                MetaLabel(signInLabel(data.employee.lastLoginAt), symbol: "clock")
            }

            NeonDivider()

            VStack(alignment: .leading, spacing: 10) {
                if let email = data.employee.email { KeyValueRow(L("Email"), value: email, symbol: "envelope") }
                if let phone = data.employee.phone { KeyValueRow(L("Phone"), value: phone, symbol: "phone") }
                if let code = data.employee.employeeCode { KeyValueRow(L("Employee ID"), value: code, symbol: "number") }
                KeyValueRow(L("Sales target"), value: L("%d projects a month", data.employee.monthlySalesTarget), symbol: "target")
                if let reviewer = data.colleagues.first(where: { $0.id == data.employee.reviewerId }) {
                    NavigationLink(value: TeamEmployeeRoute(id: reviewer.id)) {
                        HStack(spacing: 4) {
                            KeyValueRow(L("Reviewed by"), value: reviewer.name, symbol: "checkmark.seal")
                            Image(systemName: "chevron.forward")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Color.neonTextTertiary)
                        }
                    }
                    .buttonStyle(.plain)
                } else {
                    KeyValueRow(L("Reviewed by"), value: L("The manager"), symbol: "checkmark.seal")
                }
            }

            FlowRow {
                permissionChip(L("WhatsApp"), on: data.employee.canReadWhatsApp, symbol: "message")
                permissionChip(L("Assign tasks"), on: data.employee.canAssignTasks, symbol: "person.2.badge.gearshape")
                permissionChip(L("Site visits"), on: data.employee.canLogSiteVisits, symbol: "mappin.and.ellipse")
            }
        }
    }

    /// `createdAt` is a real timestamp (not a `@db.Date` day key), so it reads
    /// correctly in the phone's own timezone; only the *time* is dropped, per
    /// the fix — the exact minute isn't the point, the day is.
    private func dateOnly(_ iso: String) -> String? {
        guard let date = parseISODate(iso) else { return nil }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale))
    }

    private func signInLabel(_ iso: String?) -> String {
        guard let iso, let date = parseISODate(iso) else { return L("Never signed in") }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = AppLanguage.current.locale
        formatter.unitsStyle = .full
        return L("Signed in %@", formatter.localizedString(for: date, relativeTo: Date()))
    }

    private func permissionChip(_ title: String, on: Bool, symbol: String) -> some View {
        BadgeView(text: title, tone: on ? .success : .neutral, symbol: on ? "checkmark" : symbol)
    }

    // MARK: - Sales

    @ViewBuilder
    private func salesCard(_ sales: TeamSales) -> some View {
        SectionCard(L("Sales this month"), subtitle: teamMonthYearLabel(sales.period), symbol: "chart.line.uptrend.xyaxis", hue: .green) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(sales.projects.count)/\(sales.target)")
                    .font(.neonKPI)
                    .foregroundStyle(Color.neonInk)
                Text(L("projects sold"))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
            }
            ProgressBar(progress: sales.target == 0 ? 1 : min(1, Double(sales.projects.count) / Double(sales.target)), tint: .neonSuccess)
            Text(salesLine(sales))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)

            if !sales.projects.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(sales.projects.enumerated()), id: \.element.id) { index, project in
                        if index > 0 { NeonDivider() }
                        // Pushed directly (not via a shared route type): this
                        // screen sits in whichever stack hosts Team, never the
                        // Projects tab's own, so there is no navigationDestination
                        // for a ProjectRoute to resolve against here.
                        NavigationLink {
                            ProjectDetailView(projectId: project.id)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    DirText(project.name, font: .neonSubheadline, color: .neonInk)
                                    DirText(project.clientName, font: .neonCaption, color: .neonTextSecondary)
                                }
                                Spacer()
                                Text(formattedISODate(project.soldOn) ?? "—")
                                    .font(.neonCaption)
                                    .foregroundStyle(Color.neonTextTertiary)
                                Image(systemName: "chevron.forward")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Color.neonTextTertiary)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, 6)
                    }
                }
            }
        }
    }

    private func salesLine(_ sales: TeamSales) -> String {
        if sales.target == 0 { return L("No target set.") }
        let sold = sales.projects.count
        if sold > sales.target { return L("Target met, %d over.", sold - sales.target) }
        if sold >= sales.target { return L("Target met.") }
        return L("%d more to reach the target.", sales.target - sold)
    }

    // MARK: - Performance

    private struct PerformanceIndicatorInfo {
        let label: String
        let symbol: String
        let hue: NeonHue
        let indicator: TeamIndicator
        let render: (Double) -> String
    }

    private func performanceIndicators(_ performance: TeamPerformance) -> [PerformanceIndicatorInfo] {
        [
            .init(label: L("Delivered on time"), symbol: "checkmark.seal.fill", hue: .green, indicator: performance.onTime) { NeonFormat.percent($0) },
            .init(label: L("Accepted first time"), symbol: "hand.thumbsup.fill", hue: .blue, indicator: performance.acceptedFirstTime) { NeonFormat.percent($0) },
            .init(label: L("Sent back"), symbol: "arrow.uturn.backward", hue: .orange, indicator: performance.rework) { NeonFormat.percent($0 * 100) },
            .init(label: L("Waiting on others"), symbol: "hourglass", hue: .cyan, indicator: performance.blockedWaiting) { describeMinutes(Int($0)) },
            .init(label: L("Estimates"), symbol: "ruler", hue: .purple, indicator: performance.estimates) { describeEstimate($0) },
        ]
    }

    @ViewBuilder
    private func performanceCard(_ performance: TeamPerformance, days: Int) -> some View {
        let all = performanceIndicators(performance)
        let shown = all.filter { $0.indicator.value != nil }
        let missing = all.filter { $0.indicator.value == nil }

        SectionCard(L("How the work is going"), subtitle: L("Last %d days, measured by what came out of the work.", days), symbol: "gauge.with.dots.needle.67percent", hue: .blue) {
            if !shown.isEmpty {
                StatGrid(columns: 2) {
                    ForEach(shown, id: \.label) { info in
                        KPICard(
                            info.label,
                            text: info.render(info.indicator.value!),
                            symbol: info.symbol,
                            hue: info.hue,
                            caption: taskCountCaption(info.indicator.sample),
                            density: .compact
                        )
                    }
                }
            }

            // The refused ones together, in one block, rather than as more
            // half-empty tiles: each keeps the server's own reason — never a
            // blanket "not enough data" standing in for a real "nothing to
            // report" (`blockedWaiting`'s `why` when nothing was ever blocked
            // is a fact, not a refusal, and the two must not read the same).
            if !missing.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(missing.enumerated()), id: \.offset) { index, info in
                        if index > 0 { NeonDivider() }
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "info.circle")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color.neonTextTertiary)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(info.label)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(Color.neonTextSecondary)
                                Text(info.indicator.why ?? L("Not enough to say yet"))
                                    .font(.neonFootnote)
                                    .foregroundStyle(Color.neonTextTertiary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                .padding(12)
                .neonSurface(.sunken, radius: NeonRadius.md)
            }

            Text(L("Nothing here measures presence, hours at a desk, or how quickly somebody replies."))
                .font(.neonCaption)
                .foregroundStyle(Color.neonTextFaint)
        }
    }

    private func taskCountCaption(_ sample: Int) -> String {
        teamPlural(sample, one: "%d task", other: "%d tasks")
    }

    // MARK: - Warnings

    @ViewBuilder
    private func warningsCard(_ data: TeamEmployeeResponse) -> some View {
        TeamWarningsCard(employeeId: employeeId, name: data.employee.name, active: data.employee.active, warnings: data.warnings, limit: data.warningLimit) {
            await load()
        }
    }

    // MARK: - Account access

    @ViewBuilder
    private func accountAccessCard(_ data: TeamEmployeeResponse) -> some View {
        SectionCard(L("Account access"), symbol: "lock.shield", hue: .indigo) {
            Text(L("Disabling takes effect on the employee's next request and stops all push to their devices. Their place on the task board is untouched."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)

            // Three full-width rows, easiest-to-undo first: disabling can be
            // reversed with the same button, revoking cannot — so revoking
            // gets `.destructive` (solid red) and disabling only a tinted
            // red, rather than two buttons of equal weight for two actions
            // of very different severity.
            NeonButton(L("Set a new password"), kind: .secondary, size: .medium, fullWidth: true) {
                showPasswordReset = true
            }

            NeonButton(
                data.employee.active ? L("Disable account") : L("Enable account"),
                kind: data.employee.active ? .tinted(.neonDangerStrong) : .tinted(.neonSuccessStrong),
                size: .medium,
                fullWidth: true,
                confirm: data.employee.active ? L("Disable this account?") : nil
            ) {
                await toggleActive(active: !data.employee.active)
            }

            if data.employee.email != nil {
                NeonButton(
                    L("Revoke login"), symbol: "xmark.seal", kind: .destructive, size: .medium, fullWidth: true,
                    confirm: L("Remove %@'s email and password?", data.employee.name),
                    confirmMessage: L("They stay on the task board but can no longer sign in.")
                ) {
                    await revoke()
                }
            }

            MetaLabel(pushFooterText(data.employee.deviceCount, data.employee.notificationCount), symbol: "bell")
        }
    }

    private func pushFooterText(_ devices: Int, _ notifications: Int) -> String {
        let deviceText = teamPlural(devices, one: "%d device receiving push", other: "%d devices receiving push")
        let notificationText = teamPlural(notifications, one: "%d notification sent", other: "%d notifications sent")
        return "\(deviceText) · \(notificationText)"
    }

    private func toggleActive(active: Bool) async {
        do {
            try await api.perform("team/setEmployeeActive", args: [employeeId, active])
            Haptic.success()
            Toast.success(active ? L("Account enabled") : L("Account disabled"))
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func revoke() async {
        do {
            try await api.perform("team/revokeAccount", args: [employeeId])
            Haptic.success()
            Toast.success(L("Login revoked"))
            await load()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func load() async {
        do {
            let loaded = try await api.read("team/employee", ["id": employeeId], as: TeamEmployeeResponse.self)
            withNeonAnimation(NeonMotion.gentle) {
                response = loaded.value
                cachedAt = loaded.cachedAt
                errorMessage = nil
                // The server's answer is the face from now on.
                if loaded.cachedAt == nil { savedPhoto = nil }
            }
        } catch {
            if response == nil { errorMessage = error.localizedDescription }
        }
    }

    // MARK: - Playbook

    /// Moved out of the header (was 25+ lines of Arabic pushing the day plan,
    /// sales, performance and warnings two screens down) into its own card,
    /// below Account access, collapsed to a handful of lines until asked to
    /// show the rest.
    @ViewBuilder
    private func playbookCard(_ employee: TeamEmployeeDetail) -> some View {
        if let playbook = employee.playbook, !playbook.isEmpty {
            SectionCard(L("What they usually do"), symbol: "book.fill", hue: .indigo) {
                TeamPlaybookText(text: playbook)
                    .lineLimit(playbookExpanded ? nil : 6)
                if !playbookExpanded {
                    ViewAllButton(L("Show all")) {
                        withNeonAnimation(NeonMotion.smooth) { playbookExpanded = true }
                    }
                }
            }
        }
    }
}

// MARK: - Warnings

private struct TeamWarningsCard: View {
    let employeeId: String
    let name: String
    let active: Bool
    let warnings: [TeamWarning]
    let limit: Int
    var onChanged: () async -> Void

    @EnvironmentObject var api: APIClient
    @State private var reason = ""
    @State private var removing: TeamWarning?

    var body: some View {
        SectionCard(L("Warnings"), symbol: "exclamationmark.triangle.fill", hue: .orange, content: {
            Text(L("%@ is told on their phone the moment you give one, and sees it until you remove it.", name))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)

            if !warnings.isEmpty {
                VStack(spacing: 8) {
                    ForEach(Array(warnings.enumerated()), id: \.element.id) { index, warning in
                        HStack(alignment: .top, spacing: 10) {
                            Text("\(index + 1)")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 22, height: 22)
                                .background(Circle().fill(Color.neonOrangeStrong))
                            VStack(alignment: .leading, spacing: 3) {
                                DirText(warning.reason, font: .neonCallout, color: .neonInk)
                                Text(formattedISODate(warning.createdAt) ?? "")
                                    .font(.neonCaption)
                                    .foregroundStyle(Color.neonTextTertiary)
                            }
                            Spacer(minLength: 0)
                            IconButton("trash", label: L("Remove"), look: .plain, size: NeonSize.touch) {
                                Haptic.tap()
                                removing = warning
                            }
                        }
                        .padding(10)
                        .neonSurface(.tinted(.neonOrange), radius: NeonRadius.md)
                    }
                }
            }

            if !active {
                StatusNote(symbol: "lock.fill", tone: .neutral, title: L("Account disabled"), detail: L("Enable it above to give warnings again."))
            } else if warnings.count >= limit {
                StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: L("Already has %d warnings", limit), detail: L("Remove one before giving another."))
            } else {
                let next = warnings.count + 1
                let isFinal = next == limit
                NeonTextEditor(isFinal ? L("Reason for the final warning") : L("Reason"), text: $reason, minLines: 2, maxLines: 5, isRequired: true)
                NeonButton(
                    isFinal ? L("Give final warning and close account") : L("Give warning %d of %d", next, limit),
                    kind: .destructive, size: .medium,
                    confirm: isFinal ? L("This closes %@'s account: they are told why, then they can no longer sign in.", name) : L("Send %@ warning %d of %d? It goes to their phone now.", name, next, limit)
                ) {
                    await give()
                }
                .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }, trailing: {
            HStack(spacing: 4) {
                ForEach(0..<limit, id: \.self) { index in
                    Circle()
                        .fill(index < warnings.count ? Color.neonOrangeStrong : Color.neonLine)
                        .frame(width: 8, height: 8)
                }
            }
        })
        .confirmDestructive(
            item: $removing,
            title: { _ in L("Remove this warning?") },
            message: { _ in L("%@ will no longer see it.", name) },
            actionTitle: L("Remove")
        ) { warning in
            Task { await remove(warning) }
        }
    }

    private func give() async {
        do {
            try await api.perform("team/giveWarning", args: [employeeId], form: ["reason": reason])
            Haptic.success()
            Toast.success(L("Warning sent"))
            reason = ""
            await onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }

    private func remove(_ warning: TeamWarning) async {
        do {
            try await api.perform("team/removeWarning", args: [employeeId, warning.id])
            Haptic.tap()
            await onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

// MARK: - "What they usually do", broken into paragraphs and lists

/// The web page hands over `playbook` as one string the manager typed —
/// often several paragraphs and a dashed list run together. Read as a single
/// `Text`, that prints as a wall of Arabic with no paragraph breaks at all.
/// This groups it back into paragraphs and bullet runs before drawing it, so
/// the same words the manager wrote are easier to actually read.
private struct TeamPlaybookText: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(Self.blocks(of: text).enumerated()), id: \.offset) { _, block in
                switch block {
                case .paragraph(let line):
                    DirText(line, font: .neonCallout, color: .neonInk.opacity(0.85))
                        .lineSpacing(3)
                case .bullets(let lines):
                    BulletList(lines: lines)
                }
            }
        }
    }

    private enum Block {
        case paragraph(String)
        case bullets([String])
    }

    /// Invisible bidi marks (LRM/RLM/ALM) are stripped before the prefix
    /// check, or a manager's Arabic line starting "‎- " (a hidden mark ahead
    /// of the dash) fails `hasPrefix` and never joins the bullet run at all —
    /// which is exactly the raw-dash bug this type exists to fix. A line
    /// whose *cleaned* text starts with "-", "–", "—" or "•" joins the
    /// previous bullet run; anything else is its own paragraph. Blank lines
    /// only end whatever run they follow — they never become an empty
    /// paragraph.
    private static let bidiMarks = CharacterSet(charactersIn: "\u{200E}\u{200F}\u{061C}")
    private static let bulletMarkers = ["-", "–", "—", "•"]

    private static func blocks(of text: String) -> [Block] {
        var result: [Block] = []
        var bulletRun: [String] = []
        func flushBullets() {
            if !bulletRun.isEmpty { result.append(.bullets(bulletRun)); bulletRun = [] }
        }
        for rawLine in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let line = String(rawLine)
                .components(separatedBy: bidiMarks).joined()
                .trimmingCharacters(in: .whitespaces)
            if line.isEmpty { continue }
            if let marker = bulletMarkers.first(where: { line.hasPrefix($0) }) {
                let stripped = line.dropFirst(marker.count).trimmingCharacters(in: .whitespaces)
                bulletRun.append(stripped.isEmpty ? line : stripped)
            } else {
                flushBullets()
                result.append(.paragraph(line))
            }
        }
        flushBullets()
        return result
    }
}

// MARK: - Local formatting (mirrors lib/performance.ts, kept private to this area)

private func describeMinutes(_ total: Int) -> String {
    let hours = total / 60
    let minutes = total % 60
    if hours == 0 { return L("%dm", minutes) }
    return minutes == 0 ? L("%dh", hours) : L("%dh %dm", hours, minutes)
}

private func describeEstimate(_ ratio: Double) -> String {
    if ratio >= 0.9 && ratio <= 1.1 { return L("About right") }
    if ratio > 1.1 { return L("Takes about %.1f× the estimate", ratio) }
    return L("Finishes in about %.1f× the estimate", ratio)
}
