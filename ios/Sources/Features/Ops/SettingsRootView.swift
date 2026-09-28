import SwiftUI

/// Integrations and the values the daily jobs run on. Mirrors
/// admin/(dashboard)/settings, minus the delivery process — process sections,
/// stage periods and what each kind of work needs are the tasks area's own
/// `ProcessSettingsView()`, linked from here. Pushed from More, so no
/// `NavigationStack` of its own.
struct SettingsRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var settings: OpsSettings?
    @State private var errorMessage: String?
    @State private var cachedAt: Date?

    var body: some View {
        NeonScroll {
            NavigationLink(destination: ProcessSettingsView()) {
                ListRow(L("Delivery process"), subtitle: L("Process sections, stage periods, what each kind of work needs"), leading: .icon("list.bullet.rectangle"), chevron: true)
            }
            .buttonStyle(.pressableCard)
            .neonSurface(.solid, radius: NeonRadius.md)

            LoadStateView(value: settings, error: errorMessage, cachedAt: cachedAt, retry: load) { settings in
                PushHealthCard(health: settings.pushHealth, managerPaired: settings.managerPaired, managerDevices: settings.managerDevices)
                WorkingDayCard(workHours: settings.workHours, dayLengthMinutes: settings.dayLengthMinutes, capacityMinutes: settings.capacityMinutes, onTimeUntil: settings.onTimeUntil, onSaved: load)
                PlanningNotesCard(notes: settings.planningNotes, onSaved: load)
                AutomationCard(rules: settings.automationRules, switchedOn: settings.automationSwitchedOn, onChanged: load)
                WhatsAppStatusCard(whatsapp: settings.whatsapp)
                TimezoneCard(timezone: settings.timezone, options: settings.timezoneOptions, onSaved: load)
                OtherIntegrationsCard(aiConfigured: settings.aiConfigured)
            }
        }
        .refreshable { await load() }
        .navigationTitle(L("Settings"))
        .neonAmbientBackground()
        .task { await load() }
    }

    private func load() async {
        do {
            let loaded = try await api.opsSettings()
            settings = loaded.value
            cachedAt = loaded.cachedAt
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Push health

private struct PushHealthCard: View {
    let health: PushHealth
    let managerPaired: Bool
    let managerDevices: Int

    var body: some View {
        NeonCard {
            SectionHeader(L("Push notifications"), subtitle: L("Why a notification is or isn't arriving."))
            StatGrid {
                StatTile(L("Server keys"), text: health.configured ? (health.source == "database" ? L("Generated") : L("Set")) : L("Not set"), symbol: "key", tint: health.configured ? .neonSuccessStrong : .neonTextFaint)
                StatTile(L("Devices reachable"), value: Double(health.activeTotal), symbol: "iphone")
            }

            StatusNote(
                symbol: "apple.logo",
                tone: .info,
                title: L("This phone cannot receive push"),
                detail: L("The app is signed for testing (AltStore), which Apple does not allow to register for push notifications. This card is diagnostic only.")
            )

            if !managerPaired {
                StatusNote(symbol: "person.crop.circle.badge.questionmark", tone: .warning, title: L("No manager account"), detail: L("Pair yourself to the attendance device in Attendance to become addressable."))
            } else {
                MetaLabel(L("%d of your own devices registered", managerDevices), symbol: "person.badge.shield.checkmark")
            }

            if !health.devices.isEmpty {
                SectionLabel(L("The team's devices"))
                ForEach(health.devices) { device in
                    ListRow(device.name, meta: device.lastUsedAt.flatMap(shortTime), leading: .icon("iphone"), value: "\(device.active)")
                }
            }
        }
    }
}

// MARK: - Working day

private struct WorkingDayCard: View {
    let workHours: OpsWorkHours
    let dayLengthMinutes: Int
    let capacityMinutes: Int
    let onTimeUntil: String
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @State private var days: Set<Int>
    @State private var start: Date
    @State private var end: Date
    @State private var lunchAt: Date
    @State private var lunchMinutes: Int
    @State private var bufferMinutes: Int
    @State private var graceMinutes: Int
    @State private var error: String?

    init(workHours: OpsWorkHours, dayLengthMinutes: Int, capacityMinutes: Int, onTimeUntil: String, onSaved: @escaping () async -> Void) {
        self.workHours = workHours
        self.dayLengthMinutes = dayLengthMinutes
        self.capacityMinutes = capacityMinutes
        self.onTimeUntil = onTimeUntil
        self.onSaved = onSaved
        _days = State(initialValue: Set(workHours.days))
        _start = State(initialValue: timeStringToDate(workHours.start))
        _end = State(initialValue: timeStringToDate(workHours.end))
        _lunchAt = State(initialValue: timeStringToDate(workHours.lunchAt))
        _lunchMinutes = State(initialValue: workHours.lunchMinutes)
        _bufferMinutes = State(initialValue: workHours.bufferMinutes)
        _graceMinutes = State(initialValue: workHours.graceMinutes)
    }

    var body: some View {
        NeonCard {
            SectionHeader(L("The working day"), subtitle: L("What can be planned, which days are worked, when nobody should be messaged."))

            SectionLabel(L("Working days"))
            FlowRow {
                ForEach(Array(workingDayNames().enumerated()), id: \.offset) { index, name in
                    Chip(name, isSelected: days.contains(index)) {
                        Haptic.selection()
                        if days.contains(index) { days.remove(index) } else { days.insert(index) }
                    }
                }
            }

            TimeField(L("Starts"), time: $start)
            TimeField(L("Ends"), time: $end)
            TimeField(L("Lunch at"), time: $lunchAt)
            NumberField(L("Lunch"), value: $lunchMinutes, unit: L("min"))
            NumberField(L("Margin"), value: $bufferMinutes, unit: L("min"))
            NumberField(L("Allowed late"), value: $graceMinutes, unit: L("min"))

            Text(L("A day is %@ long, so %@ can be planned after lunch and the margin.", describeMinutes(Double(dayLengthMinutes)), describeMinutes(Double(capacityMinutes))))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)
            Text(L("Arriving by %@ is on time. After that, lateness is charged in whole hours, rounded up.", onTimeUntil))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)

            if let error { ValidationMessage(error) }

            NeonButton(L("Save the working day"), kind: .secondary, size: .medium) {
                do {
                    try await api.opsSaveWorkHours(form: [
                        "days": days.sorted(),
                        "start": dateToTimeString(start),
                        "end": dateToTimeString(end),
                        "lunchAt": dateToTimeString(lunchAt),
                        "lunchMinutes": lunchMinutes,
                        "bufferMinutes": bufferMinutes,
                        "graceMinutes": graceMinutes,
                    ])
                    Toast.success(L("Saved"))
                    error = nil
                    await onSaved()
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Planning notes

private struct PlanningNotesCard: View {
    let notes: String
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @State private var text: String
    @State private var error: String?

    init(notes: String, onSaved: @escaping () async -> Void) {
        self.notes = notes
        self.onSaved = onSaved
        _text = State(initialValue: notes)
    }

    var body: some View {
        NeonCard {
            SectionHeader(L("How we plan a day"), subtitle: L("Your rules, in your own words — read whenever a day is proposed for somebody."))
            NeonTextEditor(L("Rules for planning"), text: $text, minLines: 4, maxLines: 10)
            if let error { ValidationMessage(error) }
            NeonButton(L("Save rules"), kind: .secondary, size: .medium) {
                do {
                    try await api.opsSavePlanningNotes(text)
                    Toast.success(L("Saved"))
                    error = nil
                    await onSaved()
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Automation

private struct AutomationCard: View {
    let rules: [AutomationRule]
    let switchedOn: Bool
    let onChanged: () async -> Void

    @EnvironmentObject var api: APIClient
    @State private var showNew = false
    @State private var editing: AutomationRule?
    @State private var deleting: AutomationRule?
    @State private var preview: AutomationPreview?
    @State private var previewing = false
    @State private var toggling = false

    var body: some View {
        NeonCard {
            SectionHeader(L("Rules that watch the day"), subtitle: L("A rule can only ever speak — it never moves, ticks or approves work.")) {
                IconButton("plus", label: L("Add")) { showNew = true }
            }

            ToggleRow(L("Rules are switched on"), detail: L("The one switch that stops all of them at once."), symbol: "bolt.badge.a", isOn: Binding(
                get: { switchedOn },
                set: { on in
                    toggling = true
                    Task {
                        try? await api.opsSetAutomationSwitch(on)
                        toggling = false
                        await onChanged()
                    }
                }
            ))
            .disabled(toggling)

            if rules.isEmpty {
                EmptyState(symbol: "bolt.slash", title: L("No rules yet"))
            } else {
                ForEach(rules) { rule in
                    Button { editing = rule } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text(rule.name).font(.neonSubheadline).foregroundStyle(Color.neonInk)
                                Spacer()
                                BadgeView(text: rule.enabled ? L("On") : L("Off"), tone: rule.enabled ? .success : .neutral)
                            }
                            Text(automationTriggerLabel(rule.trigger)).font(.neonFootnote).foregroundStyle(Color.neonTextSecondary)
                            HStack(spacing: 6) {
                                BadgeView(text: automationActionLabel(rule.action), tone: .cyan)
                                BadgeView(text: automationRecipientLabel(rule.recipient), tone: .purple)
                            }
                        }
                    }
                    .buttonStyle(.pressableCard)
                    .padding(12)
                    .neonSurface(.sunken, radius: NeonRadius.md)
                    .contextMenu {
                        Button(role: .destructive) { deleting = rule } label: { Label(L("Delete"), systemImage: "trash") }
                    }
                }
            }

            NeonButton(previewing ? L("Running…") : L("Preview against today"), symbol: "eye", kind: .ghost, size: .medium, isLoading: previewing) {
                previewing = true
                preview = try? await api.opsAutomationPreview()
                previewing = false
            }

            if let preview {
                StatusNote(
                    symbol: "eye",
                    tone: .info,
                    title: L("%d considered, %d would speak", preview.considered, preview.sent),
                    detail: preview.lines.isEmpty ? L("Nothing would be said right now.") : preview.lines.prefix(6).joined(separator: "\n")
                )
                Text(L("Writes nothing — no state, no notification.")).font(.neonCaption).foregroundStyle(Color.neonTextFaint)
            }
        }
        .sheet(isPresented: $showNew) {
            AutomationRuleSheet(rule: nil) { await onChanged() }
        }
        .sheet(item: $editing) { rule in
            AutomationRuleSheet(rule: rule) { await onChanged() }
        }
        .confirmDestructive(item: $deleting, title: { L("Delete “%@”?", $0.name) }, actionTitle: L("Delete")) { rule in
            Task {
                try? await api.opsDeleteAutomationRule(id: rule.id)
                await onChanged()
            }
        }
    }
}

private struct AutomationRuleSheet: View {
    let rule: AutomationRule?
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var trigger: String
    @State private var action: String
    @State private var recipient: String
    @State private var atLeast: Int
    @State private var graceMinutes: Int
    @State private var cooldownMinutes: Int
    @State private var escalateAfterMinutes: Int?
    @State private var enabled: Bool
    @State private var error: String?

    init(rule: AutomationRule?, onSaved: @escaping () async -> Void) {
        self.rule = rule
        self.onSaved = onSaved
        _name = State(initialValue: rule?.name ?? "")
        _trigger = State(initialValue: rule?.trigger ?? automationTriggers[0])
        _action = State(initialValue: rule?.action ?? "ask")
        _recipient = State(initialValue: rule?.recipient ?? "the-person")
        _atLeast = State(initialValue: rule?.atLeast ?? 1)
        _graceMinutes = State(initialValue: rule?.graceMinutes ?? 0)
        _cooldownMinutes = State(initialValue: rule?.cooldownMinutes ?? 0)
        _escalateAfterMinutes = State(initialValue: rule?.escalateAfterMinutes)
        _enabled = State(initialValue: rule?.enabled ?? false)
    }

    var body: some View {
        SheetScaffold(
            rule == nil ? L("New rule") : L("Edit rule"),
            symbol: "bolt",
            primaryTitle: L("Save"),
            isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty
        ) {
            let form: [String: Any] = [
                "name": name,
                "trigger": trigger,
                "action": action,
                "recipient": recipient,
                "atLeast": atLeast,
                "graceMinutes": graceMinutes,
                "cooldownMinutes": cooldownMinutes,
                "escalateAfterMinutes": escalateAfterMinutes.map(String.init) ?? "",
                "enabled": enabled ? "on" : "",
            ]
            do {
                if let rule {
                    try await api.opsUpdateAutomationRule(id: rule.id, form: form)
                } else {
                    try await api.opsCreateAutomationRule(form: form)
                }
                Toast.success(L("Saved"))
                dismiss()
                await onSaved()
            } catch {
                self.error = error.localizedDescription
            }
        } content: {
            FormSection {
                NeonTextField(L("Name"), text: $name, isRequired: true)
                MenuField(L("When"), selection: $trigger, options: automationTriggers, title: automationTriggerLabel)
                MenuField(L("Then"), selection: $action, options: automationActions, title: automationActionLabel)
                MenuField(L("Tell"), selection: $recipient, options: automationRecipients, title: automationRecipientLabel)
                NumberField(L("At least this many"), value: $atLeast, hint: L("How many of the thing must be true."))
                NumberField(L("Grace"), value: $graceMinutes, unit: L("min"), hint: L("How long it must have held before anything is said."))
                NumberField(L("Cooldown"), value: $cooldownMinutes, unit: L("min"), hint: L("Before this rule may speak about the same person again."))
                NumberField(L("Escalate after"), value: $escalateAfterMinutes, unit: L("min"), hint: L("Empty: never escalate to the manager."))
                ToggleRow(L("Enabled"), isOn: $enabled)
                if let error { ValidationMessage(error) }
            }
        }
        .neonSheet([.large])
    }
}

// MARK: - WhatsApp status (a status summary here; linking itself lives on the
// WhatsApp area's own screen, which this card opens)

private struct WhatsAppStatusCard: View {
    let whatsapp: OpsSettings.WhatsApp

    var body: some View {
        NeonCard {
            SectionHeader(L("Company channel")) {
                BadgeView(
                    text: whatsapp.transport == "none" ? L("Not configured") : (whatsapp.connected ? L("Connected") : L("Unreachable")),
                    tone: whatsapp.transport == "none" ? .neutral : (whatsapp.connected ? .success : .warning)
                )
            }
            if whatsapp.transport != "none" {
                KeyValueRow(L("Transport"), value: whatsapp.transport == "cloud" ? L("Official Cloud API") : L("Session worker"), symbol: "antenna.radiowaves.left.and.right")
                if let number = whatsapp.number { KeyValueRow(L("Sends from"), value: number, symbol: "phone") }
                if let detail = whatsapp.detail { KeyValueRow(L("Status"), value: detail, symbol: "info.circle") }
            } else {
                Text(L("Neither the Cloud API nor the session worker is set up on the server.")).font(.neonFootnote).foregroundStyle(Color.neonTextTertiary)
            }

            NavigationLink(destination: WhatsAppRootView()) {
                ListRow(L("WhatsApp inbox"), subtitle: L("Link or unlink the number, and read the studio's chats"), leading: .icon("message.badge.circle.fill"), chevron: true)
            }
            .buttonStyle(.pressableCard)
            .neonSurface(.sunken, radius: NeonRadius.md)
        }
    }
}

// MARK: - Timezone

private struct TimezoneCard: View {
    let timezone: String
    let options: [String]
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @State private var selection: String
    @State private var error: String?

    init(timezone: String, options: [String], onSaved: @escaping () async -> Void) {
        self.timezone = timezone
        self.options = options
        self.onSaved = onSaved
        _selection = State(initialValue: timezone)
    }

    var body: some View {
        NeonCard {
            SectionHeader(L("Company timezone"), subtitle: L("Decides which day a task belongs to and when the daily jobs run."))
            MenuField(L("Timezone"), selection: $selection, options: options, title: { $0.replacingOccurrences(of: "_", with: " ") })
            if let error { ValidationMessage(error) }
            NeonButton(L("Save timezone"), kind: .secondary, size: .medium) {
                do {
                    try await api.opsSaveTimezone(selection)
                    Toast.success(L("Saved"))
                    error = nil
                    await onSaved()
                } catch {
                    self.error = error.localizedDescription
                }
            }
        }
    }
}

// MARK: - Other integrations

private struct OtherIntegrationsCard: View {
    let aiConfigured: Bool

    var body: some View {
        NeonCard {
            SectionHeader(L("Other integrations"))
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("AI assistant & receipt reading")).font(.neonSubheadline)
                    Text(L("Powers the manager's chat assistant and reads receipt photos.")).font(.neonCaption).foregroundStyle(Color.neonTextTertiary)
                }
                Spacer()
                BadgeView(text: aiConfigured ? L("Configured") : L("Not set"), tone: aiConfigured ? .success : .neutral)
            }
        }
    }
}

// MARK: - Time helpers ("HH:MM" ⇄ Date, for TimeField)

private func timeStringToDate(_ time: String) -> Date {
    let minutes = minutesOfTime(time) ?? 0
    var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
    components.hour = minutes / 60
    components.minute = minutes % 60
    return Calendar.current.date(from: components) ?? Date()
}

private func dateToTimeString(_ date: Date) -> String {
    let components = Calendar.current.dateComponents([.hour, .minute], from: date)
    return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
}
