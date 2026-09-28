import SwiftUI

/// A proposed day for one person, generated, edited, and only then put on the
/// board — mirrors `components/admin/day-plan-panel.tsx`. Kept on the server
/// between generating it and applying it, so leaving the screen and coming
/// back finds it exactly as it was.
struct DayPlanCard: View {
    let employeeId: String
    let name: String
    /// Day keys ("YYYY-MM-DD") in the company's timezone.
    let today: String
    let tomorrow: String
    let tomorrowLabel: String
    let aiConfigured: Bool
    let initialPlans: TeamDayPlans

    @EnvironmentObject var api: APIClient
    @State private var dayKey: String
    @State private var saved: [String: TeamDayPlan?]
    @State private var blocks: [TeamPlanBlock] = []
    @State private var dirty = false
    @State private var working = false
    @State private var errorMessage: String?
    @State private var said: String?

    init(employeeId: String, name: String, today: String, tomorrow: String, tomorrowLabel: String, aiConfigured: Bool, initialPlans: TeamDayPlans) {
        self.employeeId = employeeId
        self.name = name
        self.today = today
        self.tomorrow = tomorrow
        self.tomorrowLabel = tomorrowLabel
        self.aiConfigured = aiConfigured
        self.initialPlans = initialPlans
        _dayKey = State(initialValue: tomorrow)
        _saved = State(initialValue: [today: initialPlans.today, tomorrow: initialPlans.tomorrow])
        _blocks = State(initialValue: initialPlans.tomorrow?.blocks ?? [])
    }

    private var plan: TeamDayPlan? { saved[dayKey] ?? nil }
    private var dayName: String { dayKey == today ? L("today") : L("tomorrow") }
    private var puttable: Int { blocks.filter(\.keep).count }

    var body: some View {
        NeonCard {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionHeader(L("Plan %@'s day", name))
                    Text(L("Built from their profile, your rules, and what is open on the board."))
                        .font(.neonFootnote)
                        .foregroundStyle(Color.neonTextSecondary)
                }
                Spacer(minLength: 0)
            }

            SegmentedPill(selection: $dayKey, options: [tomorrow, today], title: { $0 == today ? L("Today") : tomorrowLabel })
                .onChange(of: dayKey) { _ in show(dayKey) }

            if !aiConfigured {
                StatusNote(symbol: "exclamationmark.circle", tone: .warning, title: L("Planning is unavailable"), detail: L("The server needs an assistant key set."))
            }

            HStack(spacing: 10) {
                NeonButton(plan != nil ? L("Generate again") : L("Generate %@'s plan", dayName), symbol: "sparkles", kind: .secondary, size: .medium, fullWidth: false, isLoading: working) {
                    await generate()
                }
                .disabled(!aiConfigured || working)

                if !blocks.isEmpty {
                    NeonButton(L("Save changes"), kind: .secondary, size: .medium, fullWidth: false, isLoading: working) {
                        await save()
                    }
                    .disabled(!dirty || working)
                }
            }

            if let errorMessage {
                StatusNote(symbol: "xmark.octagon", tone: .danger, title: errorMessage)
            }
            if let said {
                StatusNote(symbol: "checkmark.circle", tone: .success, title: said)
            }

            if !blocks.isEmpty {
                Text(planStatusLine)
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextSecondary)

                // Tick and times only, exactly what the web editor offers.
                // Reordering blocks or adding one by hand cannot be done from
                // here: saveDayPlanEdits (day-plan-actions.ts) takes a fixed-
                // length {from,to,keep}[] mapped onto the stored blocks by
                // array index — sending it reordered would attach one block's
                // time to another's task, and it refuses any length but the
                // stored one, so nothing can be appended. See FEATURES.md.
                VStack(spacing: 8) {
                    ForEach($blocks) { $block in
                        PlanBlockRow(block: $block, onEdited: { dirty = true; said = nil })
                    }
                }

                NeonButton(L("Put %d on %@", puttable, dayName), symbol: "calendar.badge.checkmark", kind: .brand, size: .medium, isLoading: working) {
                    await apply()
                }
                .disabled(dirty || puttable == 0 || working)

                if let notes = plan?.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(notes, id: \.self) { line in
                            DirText(line, font: .neonFootnote, color: .neonTextSecondary)
                        }
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .neonSurface(.sunken, radius: NeonRadius.md)
                }
            }
        }
    }

    private var planStatusLine: String {
        if let plan, plan.appliedAt != nil, !dirty { return L("On %@'s board. Edit and put it again to change it.", dayName) }
        if dirty { return L("Edited — save it before putting it on the day.") }
        return L("Tick what should go on %@.", dayName)
    }

    private func show(_ key: String) {
        blocks = saved[key].flatMap { $0?.blocks } ?? []
        dirty = false
        errorMessage = nil
        said = nil
    }

    private func generate() async {
        errorMessage = nil
        said = nil
        working = true
        defer { working = false }
        do {
            let outcome = try await api.perform("team/planDay", args: [employeeId, dayKey])
            guard let result = try outcome.result(TeamDayPlanResult.self) else { return }
            if !result.ok {
                errorMessage = result.error ?? L("That did not work.")
                return
            }
            saved[dayKey] = result.plan
            blocks = result.plan?.blocks ?? []
            dirty = false
            Haptic.success()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func save() async {
        errorMessage = nil
        working = true
        defer { working = false }
        do {
            let edits = blocks.map { ["from": $0.from, "to": $0.to, "keep": $0.keep] as [String: Any] }
            let outcome = try await api.perform("team/saveDayPlan", args: [employeeId, dayKey, edits])
            let result = try outcome.result(TeamOkResult.self)
            if result?.ok != true {
                errorMessage = result?.error ?? L("That did not save.")
                return
            }
            if var current = plan {
                current.blocks = blocks
                saved[dayKey] = current
            }
            dirty = false
            said = L("Saved.")
            Haptic.success()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func apply() async {
        errorMessage = nil
        said = nil
        working = true
        defer { working = false }
        do {
            let outcome = try await api.perform("team/applyDayPlan", args: [employeeId, dayKey])
            let result = try outcome.result(TeamApplyResult.self)
            guard result?.ok == true else {
                errorMessage = result?.error ?? L("That did not work.")
                return
            }
            var parts: [String] = []
            if let moved = result?.moved, moved > 0 { parts.append(L("%d steps scheduled", moved)) }
            if let jobs = result?.jobs, jobs > 0 { parts.append(L("%d jobs on the week board", jobs)) }
            said = L("%@ for %@. %@ has been told.", parts.isEmpty ? L("Nothing moved") : parts.joined(separator: L(" and ")), dayName, name)
            Haptic.success()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct PlanBlockRow: View {
    @Binding var block: TeamPlanBlock
    var onEdited: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Button {
                Haptic.selection()
                block.keep.toggle()
                onEdited()
            } label: {
                Image(systemName: block.keep ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(block.keep ? Color.neonSuccessStrong : Color.neonTextFaint)
            }
            .buttonStyle(.plain)
            .padding(.top, 2)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    timeField($block.from)
                    Text("–").foregroundStyle(Color.neonTextFaint)
                    timeField($block.to)
                }
                DirText(block.what, font: .neonSubheadline, color: .neonInk)
                if let taskName = block.taskName {
                    Text("\(taskName) · \(block.projectName ?? "")")
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextTertiary)
                } else {
                    Text(block.jobId != nil ? L("On the week board") : L("Goes on the week board"))
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextFaint)
                }
                if let why = block.why {
                    DirText(why, font: .neonFootnote, color: .neonTextSecondary)
                }
            }
        }
        .padding(10)
        .opacity(block.keep ? 1 : 0.5)
        .neonSurface(.solid, radius: NeonRadius.md)
    }

    private func timeField(_ text: Binding<String>) -> some View {
        DatePicker(
            "",
            selection: Binding(
                get: { PlanBlockRow.date(from: text.wrappedValue) },
                set: { text.wrappedValue = PlanBlockRow.string(from: $0); onEdited() }
            ),
            displayedComponents: .hourAndMinute
        )
        .labelsHidden()
        .scaleEffect(0.86, anchor: .leading)
        .fixedSize()
    }

    private static func date(from hhmm: String) -> Date {
        let parts = hhmm.split(separator: ":")
        var components = DateComponents()
        components.hour = parts.first.flatMap { Int($0) } ?? 9
        components.minute = parts.count > 1 ? Int(parts[1]) ?? 0 : 0
        return Calendar.current.date(from: components) ?? Date()
    }

    private static func string(from date: Date) -> String {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
    }
}
