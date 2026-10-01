import SwiftUI

/// What the team sends in: their account of the day, and things they have
/// asked to buy. Mirrors admin/(dashboard)/requests. Pushed from More, so no
/// `NavigationStack` of its own.
struct RequestsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var requests: OpsRequests?
    @State private var errorMessage: String?
    @State private var cachedAt: Date?
    @State private var deciding: (request: SupplyRequest, status: String)?

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll {
                LoadStateView(value: requests, error: errorMessage, cachedAt: cachedAt, retry: load) { data in
                    // The one thing that needs the owner leads — not four
                    // near-empty "hasn't written yet" cards. Reports follow,
                    // in a quarter of the space a card each used to take.
                    SectionHeader(L("Waiting for you"), count: data.pending.count).id("pending")
                    if data.pending.isEmpty {
                        EmptyState(symbol: "shippingbox", title: L("Nothing waiting"), detail: L("New requests appear here."), hue: .orange)
                    } else {
                        ForEach(Array(data.pending.enumerated()), id: \.element.id) { index, request in
                            SupplyRequestCard(request: request) { status in deciding = (request, status) }
                                .staggered(index)
                        }
                    }

                    TodaysReportsCard(team: data.team, reportByMember: reportBy(data))
                        .id("reports")

                    if !data.decided.isEmpty {
                        SectionHeader(L("Decided"), count: data.decided.count).id("decided")
                        CardList(data.decided) { request in
                            ListRow(
                                request.item,
                                subtitle: request.employee.name,
                                meta: request.decidedAt.flatMap(formattedISODate),
                                leading: .icon("shippingbox.fill", tint: supplyStatusIconTint(request.status)),
                                badge: supplyStatusLabel(request.status),
                                badgeTone: supplyStatusTone(request.status)
                            ) {
                                // A visible next step, not only a long-press
                                // menu nobody would find: an approved
                                // request can be marked bought right here.
                                if request.status == "APPROVED" {
                                    NeonButton(L("Mark bought"), symbol: "checkmark.circle", kind: .tinted(.neonSuccessStrong), size: .small) {
                                        deciding = (request, "PURCHASED")
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .debugScroll(proxy)
        }
        .refreshable { await load() }
        .navigationTitle(L("Requests"))
        .neonAmbientBackground()
        .sheet(item: Binding(
            get: { deciding.map { DecisionSheetItem(request: $0.request, status: $0.status) } },
            set: { if $0 == nil { deciding = nil } }
        )) { item in
            DecideSupplyRequestSheet(request: item.request, status: item.status) { await load() }
        }
        .task { await load() }
    }

    private func reportBy(_ data: OpsRequests) -> [String: OpsRequests.DailyReportEntry] {
        Dictionary(data.reports.map { ($0.employeeId, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private func load() async {
        do {
            let loaded = try await api.opsRequests()
            requests = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct DecisionSheetItem: Identifiable {
    let request: SupplyRequest
    let status: String
    var id: String { request.id + status }
}

// MARK: - Today's reports

/// One compact card: written reports as rows, and everybody who hasn't
/// written yet as a single line — never a card each saying only "hasn't
/// written today's report yet", which read as four near-empty forms rather
/// than one small fact. Silence is still never a verdict: the line only
/// ever counts who is quiet, and never claims to know why.
private struct TodaysReportsCard: View {
    let team: [OpsRequests.TeamMember]
    let reportByMember: [String: OpsRequests.DailyReportEntry]

    private var written: [(member: OpsRequests.TeamMember, report: OpsRequests.DailyReportEntry)] {
        team.compactMap { member in reportByMember[member.id].map { (member, $0) } }
    }

    private var unwritten: [OpsRequests.TeamMember] {
        team.filter { reportByMember[$0.id] == nil }
    }

    var body: some View {
        SectionCard(L("Today's reports"), symbol: "note.text", hue: .indigo) {
            if team.isEmpty {
                Text(L("No team yet")).font(.neonSubheadline).foregroundStyle(Color.neonTextTertiary)
            } else {
                if !written.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(Array(written.enumerated()), id: \.offset) { index, pair in
                            ListRow(
                                pair.member.name,
                                subtitle: pair.report.text,
                                meta: shortTime(pair.report.updatedAt),
                                leading: .avatar(url: facePhotoURL(pair.member.photoUrl), name: pair.member.name)
                            )
                            if index < written.count - 1 { NeonDivider() }
                        }
                    }
                }
                if !unwritten.isEmpty {
                    HStack(spacing: 10) {
                        AvatarStack(unwritten.map { AvatarItem(id: $0.id, name: $0.name, url: facePhotoURL($0.photoUrl)) }, size: 26, limit: 5)
                        Text(L("%d haven't written today's report yet", unwritten.count))
                            .font(.neonSubheadline)
                            .foregroundStyle(Color.neonTextSecondary)
                        Spacer(minLength: 0)
                    }
                    .padding(.top, written.isEmpty ? 0 : 4)
                }
            }
        }
    }
}

// MARK: - Supply requests

private struct SupplyRequestCard: View {
    let request: SupplyRequest
    let onDecide: (String) -> Void

    @State private var noteExpanded = false

    var body: some View {
        NeonCard {
            HStack(alignment: .top, spacing: 10) {
                IconTile("shippingbox.fill", hue: request.urgent ? .pink : .orange, size: NeonSize.iconTile)
                VStack(alignment: .leading, spacing: 4) {
                    // `fill: false`, same as `ListRow`'s own title — a
                    // trailing-aligned Arabic title otherwise expands to
                    // fill the row and then hugs the far edge, leaving a
                    // gap between it and the tile on the leading side.
                    HStack(spacing: 6) {
                        DirText(request.item, font: .neonHeadline, fill: false)
                        if request.urgent { BadgeView(text: L("Urgent"), tone: .pink) }
                    }
                    // Name and a relative date only — the role and a year
                    // nobody needs for "yesterday" were what wrapped this
                    // onto two lines.
                    // Who asked, by face as well as by name.
                    HStack(spacing: 6) {
                        AvatarView(url: facePhotoURL(request.employee.photoUrl), name: request.employee.name, size: 18)
                        Text("\(request.employee.name) · \(relativeDayTime(request.createdAt) ?? "")")
                            .font(.neonFootnote)
                            .foregroundStyle(Color.neonTextTertiary)
                            .lineLimit(1)
                    }
                    if let note = request.note, !note.isEmpty {
                        DirText(note, font: .neonSubheadline, color: .neonTextSecondary, lineLimit: noteExpanded ? nil : 4)
                        if !noteExpanded && noteMayBeClamped(note) {
                            ViewAllButton(L("Show more"), hue: request.urgent ? .pink : .orange, chevron: false) {
                                withNeonAnimation(.smooth) { noteExpanded = true }
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }

            // A request never says it's a purchase by default — a daily
            // report mis-filed as one ("تقرير اليومي") has no quantity or
            // cost, and this line is what makes that obvious before Approve.
            SectionLabel(L("To buy"))
            if let lines = request.lines, !lines.isEmpty {
                SupplyLinesList(lines: lines)
            } else if request.quantity != nil || request.estimatedCost != nil {
                if let quantity = request.quantity { KeyValueRow(L("Quantity"), value: quantity, symbol: "number") }
                if let cost = request.estimatedCost {
                    KeyValueRow(L("Cost"), value: "≈ \(NeonFormat.money(cost, decimals: 2))", symbol: "banknote")
                }
            } else {
                Text(L("No quantity or cost given"))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextTertiary)
            }

            HStack(spacing: 10) {
                NeonButton(L("Approve"), symbol: "checkmark", kind: .tinted(.neonSuccessStrong), size: .medium) { onDecide("APPROVED") }
                NeonButton(L("Decline"), symbol: "xmark", kind: .secondary, size: .medium) { onDecide("REJECTED") }
            }
        }
    }
}

/// A cheap stand-in for "will this truncate at 4 lines": long enough in
/// characters, or already broken into enough lines by hand, that clamping
/// is likely to have cut something — so "Show more" isn't offered on a
/// one-line note with nothing more to show.
private func noteMayBeClamped(_ note: String) -> Bool {
    note.count > 180 || note.filter { $0 == "\n" }.count >= 3
}

private struct DecideSupplyRequestSheet: View {
    let request: SupplyRequest
    let status: String
    let onDecided: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var error: String?

    var body: some View {
        SheetScaffold(
            title,
            subtitle: request.item,
            symbol: status == "APPROVED" ? "checkmark.circle" : "xmark.circle",
            primaryTitle: title,
            primaryKind: status == "REJECTED" ? .destructive : .primary
        ) {
            do {
                try await api.opsDecideSupplyRequest(id: request.id, status: status, decisionNote: note)
                Toast.success(L("Saved"))
                dismiss()
                await onDecided()
            } catch {
                self.error = error.localizedDescription
            }
        } content: {
            FormSection {
                NeonTextEditor(L("Note for the employee (optional)"), text: $note, minLines: 2, maxLines: 5)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium])
    }

    private var title: String { status == "APPROVED" ? L("Approve") : status == "REJECTED" ? L("Decline") : L("Mark bought") }
}
