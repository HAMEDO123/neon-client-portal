import SwiftUI

/// Where the studio has been, and what came of it. Serves both sides: the
/// manager reads every visit and answers for none of them; a permitted team
/// member keeps their own diary — plans a visit, then answers VISITED,
/// MISSED (both need words) or CANCELLED (does not). Pushed from More, so no
/// `NavigationStack` of its own.
struct SiteVisitsRootView: View {
    @EnvironmentObject var api: APIClient

    var body: some View {
        Group {
            if api.identity?.side == .admin {
                ManagerSiteVisitsView()
            } else {
                MySiteVisitsView()
            }
        }
    }
}

// MARK: - The manager's reading: every visit, none of them theirs to answer

private struct ManagerSiteVisitsView: View {
    @EnvironmentObject var api: APIClient
    @State private var visits: [SiteVisit]?
    @State private var errorMessage: String?
    @State private var cachedAt: Date?
    @State private var showWhoLogs = false

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll {
                LoadStateView(value: visits, error: errorMessage, cachedAt: cachedAt, retry: load) { visits in
                    if visits.isEmpty {
                        // Says why it's empty — only somebody ticked "Logs
                        // site visits" on their own page can plan one — and
                        // offers the one place that changes: the team list,
                        // where that tick lives on each person's page.
                        EmptyState(
                            symbol: "mappin.and.ellipse",
                            title: L("No site visits yet"),
                            detail: L("Only people with “Logs site visits” ticked on their page can plan one."),
                            actionTitle: L("Choose who logs visits"),
                            action: { showWhoLogs = true },
                            hue: .indigo,
                            card: true
                        )
                    } else {
                        let owed = visits.filter(siteVisitAwaitingReport)
                        let upcoming = visits.filter(siteVisitUpcoming)
                        let settled = visits.filter { !siteVisitAwaitingReport($0) && !siteVisitUpcoming($0) }

                        VisitGroup(
                            title: L("Not written up yet"),
                            hint: L("The time has passed and nobody has said what happened. That is not a record of anybody missing a visit."),
                            visits: owed,
                            tone: .neonWarningStrong
                        )
                        .id("owed")
                        VisitGroup(title: L("Coming up"), visits: upcoming, tone: .neonCyanStrong).id("upcoming")
                        VisitGroup(title: L("Done"), visits: settled, tone: .neonInk).id("done")
                    }
                }
            }
            .debugScroll(proxy)
        }
        .refreshable { await load() }
        .navigationTitle(L("Site visits"))
        .neonAmbientBackground()
        .navigationDestination(isPresented: $showWhoLogs) { EmployeesRootView() }
        .task { await load() }
    }

    private func load() async {
        do {
            let loaded = try await api.opsSiteVisits()
            visits = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @ViewBuilder
    private func VisitGroup(title: String, hint: String? = nil, visits: [SiteVisit], tone: Color) -> some View {
        if !visits.isEmpty {
            SectionHeader(title, subtitle: hint, count: visits.count)
            CardList(visits) { visit in
                VisitReadRow(visit: visit)
            }
        }
    }
}

/// One hue per idea, kept the same everywhere a visit's state is drawn:
/// warm orange for one owed, cool cyan for one still ahead, green/red for a
/// settled outcome, grey for one called off.
private func siteVisitHue(_ visit: SiteVisit) -> NeonHue {
    if siteVisitAwaitingReport(visit) { return .orange }
    switch visit.state {
    case "PLANNED": return .cyan
    case "VISITED": return .green
    case "MISSED": return .red
    default: return .grey
    }
}

private struct VisitReadRow: View {
    let visit: SiteVisit

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                IconTile("mappin.and.ellipse", hue: siteVisitHue(visit), size: NeonSize.iconTile)
                VStack(alignment: .leading, spacing: 3) {
                    DirText(visit.title, font: .neonHeadline)
                    HStack(spacing: 6) {
                        AvatarView(url: facePhotoURL(visit.employee.photoUrl), name: visit.employee.name, size: 18)
                        Text(visit.employee.name).font(.neonFootnote).foregroundStyle(NeonPalette.color(for: visit.employee.name))
                        Text(formattedISODate(visit.scheduledAt) ?? "").font(.neonFootnote).foregroundStyle(Color.neonTextTertiary)
                    }
                    if let location = visit.location { MetaLabel(location, symbol: "mappin") }
                    if let project = visit.project { MetaLabel(project.name, symbol: "folder") }
                }
                Spacer()
                // An owed visit is still `state == "PLANNED"` underneath, so
                // the raw label read "Planned" here — disagreeing with the
                // group's own "Not written up yet" heading right above it.
                if siteVisitAwaitingReport(visit) {
                    BadgeView(text: L("Not written up yet"), tone: .orange)
                } else {
                    BadgeView(text: siteVisitStateLabel(visit.state), tone: siteVisitStateTone(visit.state))
                }
            }
            if let purpose = visit.purpose {
                KeyValueRow(L("Planned to"), value: purpose, userText: true)
            }
            if let report = visit.report {
                KeyValueRow(visit.state == "VISITED" ? L("What came of it") : L("Why not"), value: report, userText: true)
            }
        }
        .padding(14)
        .neonSurface(.solid, radius: NeonRadius.md)
    }
}

// MARK: - A team member's own diary

private struct MySiteVisitsView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: MySiteVisits?
    @State private var errorMessage: String?
    @State private var cachedAt: Date?
    @State private var showNew = false
    @State private var editing: SiteVisit?
    @State private var answering: (visit: SiteVisit, state: String)?
    @State private var callingOff: SiteVisit?
    @State private var deleting: SiteVisit?

    var body: some View {
        ScrollViewReader { proxy in
            NeonScroll {
                LoadStateView(value: data, error: errorMessage, cachedAt: cachedAt, retry: load) { data in
                    let owed = data.visits.filter(siteVisitAwaitingReport)
                    let rest = data.visits.filter { !siteVisitAwaitingReport($0) }

                    if data.visits.isEmpty {
                        EmptyState(symbol: "mappin.and.ellipse", title: L("No site visits written down yet."), hue: .indigo, card: true)
                    } else {
                        if !owed.isEmpty {
                            SectionHeader(L("Waiting on your write-up"), count: owed.count).id("owed")
                            ForEach(Array(owed.enumerated()), id: \.element.id) { index, visit in
                                row(visit, projects: data.projects).staggered(index)
                            }
                        }
                        SectionHeader(L("Your visits")).id("mine")
                        ForEach(Array(rest.enumerated()), id: \.element.id) { index, visit in
                            row(visit, projects: data.projects).staggered(index)
                        }
                    }
                }
            }
            .debugScroll(proxy)
        }
        .refreshable { await load() }
        .navigationTitle(L("Site visits"))
        .neonAmbientBackground()
        .floatingActionButton(label: L("Schedule a site visit")) { showNew = true }
        .sheet(isPresented: $showNew) {
            VisitFormSheet(visit: nil, projects: data?.projects ?? []) { await load() }
        }
        .sheet(item: $editing) { visit in
            VisitFormSheet(visit: visit, projects: data?.projects ?? []) { await load() }
        }
        .sheet(item: Binding(
            get: { answering.map { AnsweringItem(visit: $0.visit, state: $0.state) } },
            set: { if $0 == nil { answering = nil } }
        )) { item in
            AnswerVisitSheet(visit: item.visit, state: item.state) { await load() }
        }
        .confirmDestructive(
            item: $callingOff,
            title: { L("Call off “%@”?", $0.title) },
            actionTitle: L("Call it off")
        ) { visit in
            Task {
                try? await api.opsReportSiteVisit(id: visit.id, state: "CANCELLED", report: "")
                await load()
            }
        }
        .confirmDestructive(
            item: $deleting,
            title: { L("Delete “%@”?", $0.title) },
            actionTitle: L("Delete")
        ) { visit in
            Task {
                try? await api.opsDeleteSiteVisit(id: visit.id)
                await load()
            }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func row(_ visit: SiteVisit, projects: [SiteVisitProject]) -> some View {
        VisitEditRow(
            visit: visit,
            onWent: { answering = (visit, "VISITED") },
            onMissed: { answering = (visit, "MISSED") },
            onEdit: { editing = visit },
            onCallOff: { callingOff = visit },
            onDelete: { deleting = visit }
        )
    }

    private func load() async {
        do {
            let loaded = try await api.opsMySiteVisits()
            data = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct AnsweringItem: Identifiable {
    let visit: SiteVisit
    let state: String
    var id: String { visit.id + state }
}

private struct VisitEditRow: View {
    let visit: SiteVisit
    let onWent: () -> Void
    let onMissed: () -> Void
    let onEdit: () -> Void
    let onCallOff: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                IconTile("mappin.and.ellipse", hue: siteVisitHue(visit), size: NeonSize.iconTile)
                VStack(alignment: .leading, spacing: 3) {
                    DirText(visit.title, font: .neonHeadline)
                    HStack(spacing: 6) {
                        Image(systemName: "calendar").font(.system(size: 10))
                        Text(formattedISODate(visit.scheduledAt) ?? "")
                    }
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextTertiary)
                    if let location = visit.location { MetaLabel(location, symbol: "mappin") }
                    if let project = visit.project { MetaLabel(project.name, symbol: "folder") }
                }
                Spacer()
                BadgeView(text: siteVisitStateLabel(visit.state), tone: siteVisitStateTone(visit.state))
            }

            if let purpose = visit.purpose { DirText(purpose, font: .neonSubheadline, color: .neonTextSecondary) }
            if let report = visit.report {
                KeyValueRow(visit.state == "VISITED" ? L("What came of it") : L("Why not"), value: report, userText: true)
            }

            if visit.state == "PLANNED" {
                HStack(spacing: 8) {
                    NeonButton(L("I went"), symbol: "checkmark", kind: .tinted(.neonSuccessStrong), size: .medium) { onWent() }
                    NeonButton(L("Did not go"), symbol: "xmark", kind: .secondary, size: .medium) { onMissed() }
                }
                HStack(spacing: 14) {
                    Button(action: onEdit) { Label(L("Edit"), systemImage: "pencil") }
                    Button(action: onCallOff) { Label(L("Call off"), systemImage: "slash.circle") }
                    Spacer()
                    Button(role: .destructive, action: onDelete) { Label(L("Delete"), systemImage: "trash") }
                }
                .font(.neonCaption)
                .buttonStyle(.plain)
                .foregroundStyle(Color.neonTextSecondary)
            }
        }
        .padding(14)
        .neonSurface(.solid, radius: NeonRadius.md)
    }
}

// MARK: - Writing a visit down, or changing one nobody has answered yet

private struct VisitFormSheet: View {
    let visit: SiteVisit?
    let projects: [SiteVisitProject]
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var when: Date
    @State private var location: String
    @State private var purpose: String
    @State private var projectId: String?
    @State private var error: String?

    init(visit: SiteVisit?, projects: [SiteVisitProject], onSaved: @escaping () async -> Void) {
        self.visit = visit
        self.projects = projects
        self.onSaved = onSaved
        _title = State(initialValue: visit?.title ?? "")
        _when = State(initialValue: visit.flatMap { parseISODate($0.scheduledAt) } ?? Date().addingTimeInterval(3600))
        _location = State(initialValue: visit?.location ?? "")
        _purpose = State(initialValue: visit?.purpose ?? "")
        _projectId = State(initialValue: visit?.project?.id)
    }

    var body: some View {
        SheetScaffold(
            visit == nil ? L("New site visit") : L("Edit the visit"),
            symbol: "mappin.and.ellipse",
            primaryTitle: visit == nil ? L("Schedule it") : L("Save"),
            isPrimaryEnabled: !title.trimmingCharacters(in: .whitespaces).isEmpty
        ) {
            let form: [String: Any] = [
                "title": title,
                "scheduledAt": ISO8601DateFormatter().string(from: when),
                "location": location,
                "purpose": purpose,
                "projectId": projectId ?? "",
            ]
            do {
                if let visit {
                    try await api.opsUpdateSiteVisit(id: visit.id, form: form)
                } else {
                    try await api.opsScheduleSiteVisit(form: form)
                }
                Toast.success(L("Saved"))
                dismiss()
                await onSaved()
            } catch {
                self.error = error.localizedDescription
            }
        } content: {
            FormSection {
                NeonTextField(L("What is the visit for"), text: $title, isRequired: true)
                DateField(L("When"), date: $when, components: [.date, .hourAndMinute])
                NeonTextField(L("Where"), text: $location, prompt: L("Abdoun, behind the bakery"))
                MenuField(
                    L("Project"),
                    selection: $projectId,
                    options: projects.map(\.id),
                    title: { id in
                        guard let project = projects.first(where: { $0.id == id }) else { return "" }
                        guard let client = project.clientName else { return project.name }
                        return "\(project.name) — \(client)"
                    },
                    noneTitle: L("Not tied to a project")
                )
                NeonTextEditor(L("What you plan to do there"), text: $purpose, minLines: 3, maxLines: 6)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.large])
    }
}

// MARK: - Answering: what came of it, or why not

private struct AnswerVisitSheet: View {
    let visit: SiteVisit
    let state: String
    let onAnswered: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var report = ""
    @State private var error: String?

    private var went: Bool { state == "VISITED" }

    var body: some View {
        SheetScaffold(
            went ? L("What came of it?") : L("Why did it not happen?"),
            subtitle: visit.title,
            symbol: went ? "checkmark.circle" : "xmark.circle",
            primaryTitle: went ? L("Mark as visited") : L("Mark as not visited"),
            primaryKind: went ? .tinted(.neonSuccessStrong) : .primary,
            isPrimaryEnabled: !report.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ) {
            do {
                try await api.opsReportSiteVisit(id: visit.id, state: state, report: report)
                Toast.success(L("Saved"))
                dismiss()
                await onAnswered()
            } catch {
                self.error = error.localizedDescription
            }
        } content: {
            FormSection {
                NeonTextEditor(
                    went ? L("What you saw, what was decided, what happens next") : L("What got in the way, and whether it is being rescheduled"),
                    text: $report,
                    minLines: 4,
                    maxLines: 10,
                    isRequired: true
                )
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.medium, .large])
    }
}
