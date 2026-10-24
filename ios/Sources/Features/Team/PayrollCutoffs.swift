import SwiftUI

// Cutoffs: money taken off for a stated reason — the website's
// `components/admin/cutoffs.tsx`, on the payroll page.
//
// The manager's own — hours of pay or an amount, with the reason the person
// is told — and the automatic ones the end-of-day rule makes, listed together
// because either kind can be taken back here, one at a time. Taking one back
// keeps it on record, struck through; the person is told either way.

extension APIClient {
    func fetchCutoffs(period: String?) async throws -> Loaded<TeamCutoffsResponse> {
        try await read("team/cutoffs", ["period": period], as: TeamCutoffsResponse.self)
    }

    /// Form: `employeeId`, `hours` or `amount` (JOD), `reason`. Added to today,
    /// so to this month's pay.
    @discardableResult
    func addCutoff(form: [String: Any]) async throws -> ActionOutcome {
        try await perform("team/cutoffs/add", form: form)
    }

    /// Takes one back, the manager's own or an automatic one.
    @discardableResult
    func takeBackCutoff(id: String) async throws -> ActionOutcome {
        try await perform("team/cutoffs/remove", args: [id])
    }

    /// The end-of-day rule on or off. Turning it off forgets that it was
    /// announced, so turning it on again tells everybody again first.
    @discardableResult
    func setCutoffRule(on: Bool) async throws -> ActionOutcome {
        try await perform("team/cutoffs/rule", args: [on])
    }
}

// MARK: - The section

/// The payroll screen's "Cutoffs" card, for the month the screen is on.
struct PayrollCutoffsCard: View {
    let data: TeamCutoffsResponse?
    let error: String?
    /// A cutoff is added to today, so only the month being looked at when
    /// that is this month offers to add one.
    let isThisMonth: Bool
    var onAdd: () -> Void
    /// Reads cutoffs and payroll again: the pay total includes them.
    var onChanged: () async -> Void

    @EnvironmentObject var api: APIClient
    /// The switch's new position while the server is asked, so it moves at
    /// once and comes back if refused.
    @State private var pendingRule: Bool?
    @State private var askingToTurnOn = false
    @State private var expanded = false

    /// More than this many and the rest wait behind "View All".
    private static let shown = 6

    var body: some View {
        SectionCard(
            L("Cutoffs"),
            subtitle: L("Money taken off for a reason."),
            symbol: "scissors", hue: .red
        ) {
            // The rest of the website's sentence, whole: a card's subtitle
            // stops at two lines.
            Text(L("Add one yourself, or take any of them back — the person is told either way."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let data {
                rule(data.rule)
                NeonDivider()
                list(data)
            } else if let error {
                StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: L("The cutoffs could not be read"), detail: error)
                NeonButton(L("Try again"), symbol: "arrow.clockwise", kind: .secondary, size: .small, fullWidth: false) {
                    await onChanged()
                }
            } else {
                SkeletonRows(count: 2)
            }

            if isThisMonth {
                NeonButton(L("Add a cutoff"), symbol: "plus", kind: .secondary, size: .small, fullWidth: false) {
                    Haptic.tap()
                    onAdd()
                }
            } else {
                Text(L("A cutoff is added to this month's pay, so it is added while looking at this month."))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
            }
        }
        .confirmationDialog(L("Turn the rule on?"), isPresented: $askingToTurnOn, titleVisibility: .visible) {
            Button(L("Turn on")) { Task { await setRule(true) } }
            Button(L("Cancel"), role: .cancel) {}
        } message: {
            Text(L("Everybody is told about it first, and only the days after that count."))
        }
    }

    // MARK: The rule

    @ViewBuilder
    private func rule(_ rule: TeamCutoffRule) -> some View {
        let on = pendingRule ?? rule.on
        ToggleRow(
            ruleTitle(rule),
            detail: on ? ruleOnDetail(rule) : L("Off. Nothing is taken off automatically for a late task."),
            symbol: "clock.badge.exclamationmark",
            tint: .neonDangerStrong,
            isOn: Binding(
                get: { on },
                set: { wanted in
                    guard pendingRule == nil else { return }
                    Haptic.selection()
                    // Turning it on tells the whole team, so it is asked first.
                    if wanted {
                        askingToTurnOn = true
                    } else {
                        Task { await setRule(false) }
                    }
                }
            )
        )
        .disabled(pendingRule != nil)
    }

    private func ruleTitle(_ rule: TeamCutoffRule) -> String {
        let at = teamClockTime(rule.at)
        return rule.hoursPerTask == 1
            ? L("One hour per task not handed in by %@", at)
            : L("%@ hours per task not handed in by %@", NeonFormat.number(rule.hoursPerTask, decimals: 2), at)
    }

    /// The website's sentence, with the times the server runs at, and the
    /// part that keeps it fair: nobody is charged for a rule they were not
    /// told about first.
    private func ruleOnDetail(_ rule: TeamCutoffRule) -> String {
        let cost = rule.hoursPerTask == 1 ? L("an hour's pay") : L("%@ hours' pay", NeonFormat.number(rule.hoursPerTask, decimals: 2))
        return L("On. Everybody is warned at %@ about tasks due that day and still out; at %@ each one costs %@. Nobody is charged before they were told about the rule.",
                 teamClockTime(rule.warnAt), teamClockTime(rule.at), cost)
    }

    private func setRule(_ on: Bool) async {
        withNeonAnimation(NeonMotion.snappy) { pendingRule = on }
        do {
            try await api.setCutoffRule(on: on)
            Haptic.success()
            Toast.success(on ? L("The rule is on") : L("The rule is off"),
                          detail: on ? L("Everybody is told first.") : nil)
            await onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
        withNeonAnimation(NeonMotion.snappy) { pendingRule = nil }
    }

    // MARK: The list

    @ViewBuilder
    private func list(_ data: TeamCutoffsResponse) -> some View {
        let live = data.cutoffs.filter { !$0.isTakenBack }
        if data.cutoffs.isEmpty {
            EmptyState(symbol: "scissors", title: L("No cutoffs this month"), hue: .red)
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(NeonFormat.money(-live.reduce(0) { $0 + $1.amount }, decimals: 2))
                    .font(.neonNumberSmall)
                    .foregroundStyle(Color.neonDangerStrong)
                Text(live.count == 1 ? L("1 cutoff counts this month") : L("%d cutoffs count this month", live.count))
                    .font(.neonLabel)
                    .foregroundStyle(Color.neonTextSecondary)
                Spacer(minLength: 0)
            }

            let rows = expanded ? data.cutoffs : Array(data.cutoffs.prefix(Self.shown))
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, cutoff in
                    if index > 0 { NeonDivider() }
                    PayrollCutoffRow(cutoff: cutoff) { await takeBack(cutoff) }
                }
            }
            if data.cutoffs.count > Self.shown {
                ViewAllButton(expanded ? L("Show fewer") : L("Show all %d", data.cutoffs.count), hue: .red, chevron: !expanded) {
                    withNeonAnimation(NeonMotion.smooth) { expanded.toggle() }
                }
            }
        }
    }

    private func takeBack(_ cutoff: TeamCutoff) async {
        do {
            try await api.takeBackCutoff(id: cutoff.id)
            Haptic.success()
            Toast.success(L("Taken back"), detail: L("%@ has been told.", teamIsolated(cutoff.employeeName)))
            await onChanged()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

/// One cutoff: who, which day, whose doing, the reason they were told, and
/// what it took off — struck through once it was taken back.
private struct PayrollCutoffRow: View {
    let cutoff: TeamCutoff
    var onTakeBack: () async -> Void

    var body: some View {
        let gone = cutoff.isTakenBack
        HStack(alignment: .top, spacing: 12) {
            IconTile(cutoff.isAutomatic ? "clock.badge.exclamationmark" : "scissors", hue: cutoff.isAutomatic ? .orange : .red, size: 34)
            VStack(alignment: .leading, spacing: 3) {
                DirText(cutoff.employeeName, font: .neonSubheadline, color: .neonInk, fill: false, lineLimit: 1)
                Text(L("%@ · %@", teamDayLabel(cutoff.day), cutoff.isAutomatic ? L("automatic") : L("by you")))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
                    .lineLimit(1)
                DirText(cutoff.reason, font: .neonCaption, color: .neonTextSecondary, fill: false, lineLimit: 3)
                    .strikethrough(gone)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 6) {
                VStack(alignment: .trailing, spacing: 1) {
                    Text(NeonFormat.money(-cutoff.amount, decimals: 2))
                        .font(.neonNumberSmall)
                        .foregroundStyle(gone ? Color.neonTextTertiary : Color.neonDangerStrong)
                        .strikethrough(gone)
                    if let hours = cutoff.hours {
                        Text(L("%@ h", NeonFormat.number(hours, decimals: 2)))
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextTertiary)
                    }
                }
                if gone {
                    BadgeView(text: L("Taken back"), tone: .neutral, symbol: "arrow.uturn.backward")
                } else {
                    NeonButton(L("Take back"), symbol: "arrow.uturn.backward", kind: .secondary, size: .small, fullWidth: false,
                               confirm: L("Take this cutoff back?"),
                               confirmMessage: L("%@ gets it back and is told. It stays on record, struck through.", teamIsolated(cutoff.employeeName))) {
                        await onTakeBack()
                    }
                }
            }
            .fixedSize()
        }
        .padding(.vertical, 10)
        .opacity(gone ? 0.6 : 1)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Adding one

/// Who, hours of pay or an amount, and the reason — required, because the
/// person is told it. Hours are priced at that person's rate on the server
/// when it is written; the figure under the box is only what that comes to now.
struct AddCutoffSheet: View {
    let employees: [TeamPayrollEmployee]
    /// Each person's hourly rate, from the pay sheet, for the hint.
    let rates: [String: Double]
    var onSaved: () async -> Void

    enum Measure: Hashable { case hours, amount }

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    // Nobody until somebody is chosen: this is somebody's pay.
    @State private var employeeId: String?
    @State private var measure: Measure = .hours
    @State private var hours: Double?
    @State private var amount: Double?
    @State private var reason = ""

    private var figure: Double? { measure == .hours ? hours : amount }

    private var isValid: Bool {
        employeeId != nil && (figure ?? 0) > 0 && !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var hoursHint: String? {
        guard let employeeId, let hours, hours > 0, let rate = rates[employeeId], rate > 0 else { return nil }
        let name = employees.first { $0.id == employeeId }?.name ?? ""
        return L("About %@ at %@'s rate now.", NeonFormat.money(hours * rate, decimals: 2), teamIsolated(name))
    }

    var body: some View {
        SheetScaffold(L("Add a cutoff"),
                      subtitle: L("Taken off this month's pay. They are told the reason."),
                      symbol: "scissors",
                      primaryTitle: L("Add cutoff"),
                      isPrimaryEnabled: isValid,
                      onPrimary: { await save() }) {
            FormSection {
                MenuField(L("Who"), selection: $employeeId, options: employees.map(\.id),
                          title: { id in employees.first { $0.id == id }?.name ?? id },
                          placeholder: L("Choose somebody"), leadingSymbol: "person", isRequired: true)
                SegmentedPill(selection: $measure, options: [.hours, .amount],
                              title: { $0 == .hours ? L("Hours of pay") : L("Amount in JOD") })
                if measure == .hours {
                    NumberField(L("Hours of pay"), value: $hours, unit: L("h"), decimals: 2, symbol: "clock", isRequired: true, hint: hoursHint)
                } else {
                    MoneyField(L("Amount in JOD"), amount: $amount, isRequired: true)
                }
                NeonTextEditor(L("Reason"), text: $reason, prompt: L("The reason — they are told it"), minLines: 2, isRequired: true, limit: 300)
            }
        }
        .neonSheet([.large])
    }

    private func save() async {
        guard let employeeId, let figure, figure > 0 else { return }
        var form: [String: Any] = ["employeeId": employeeId, "reason": reason]
        // One or the other, never both: the server would take the hours.
        form[measure == .hours ? "hours" : "amount"] = String(figure)
        do {
            try await api.addCutoff(form: form)
            Haptic.success()
            Toast.success(L("Cutoff added"), detail: L("%@ has been told.", teamIsolated(employees.first { $0.id == employeeId }?.name ?? "")))
            dismiss()
            await onSaved()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}
