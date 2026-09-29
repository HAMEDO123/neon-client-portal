import SwiftUI

/// Add, edit or remove one person's figure for one day — `setAttendance` /
/// `deleteAttendance` in operations-actions.ts, the payroll screen's own
/// actions. The website's rules travel with the server call unchanged: saved
/// as MANUAL either way (a manager's figure wins over the device, and
/// correcting a device day re-marks it MANUAL so the next sync leaves it
/// alone), and both hours are clamped to 0–24 there regardless of what is
/// typed here.
struct AttendanceCorrectionSheet: View {
    let employeeId: String
    let employeeName: String
    /// Nil only when opened from a blank day with nothing recorded yet.
    let recordId: String?
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var day: Date
    @State private var delayHours: String
    @State private var earlyHours: String
    @State private var note: String
    @State private var error: String?
    @State private var confirmRemove = false
    @State private var removing = false

    init(
        employeeId: String,
        employeeName: String,
        dayKey: String,
        recordId: String? = nil,
        entry: AttendanceMonth.Entry? = nil,
        onSaved: @escaping () async -> Void
    ) {
        self.employeeId = employeeId
        self.employeeName = employeeName
        self.recordId = recordId
        self.onSaved = onSaved
        _day = State(initialValue: NeonFormat.date(fromDayKey: dayKey) ?? Date())
        _delayHours = State(initialValue: formatHours(entry?.delayHours))
        _earlyHours = State(initialValue: formatHours(entry?.earlyHours))
        _note = State(initialValue: entry?.note ?? "")
    }

    var body: some View {
        SheetScaffold(
            employeeName,
            subtitle: recordId != nil ? L("Correct this day") : L("Add a correction"),
            symbol: "clock.badge.exclamationmark",
            primaryTitle: L("Save"),
            isPrimaryEnabled: Double(delayHours) != nil && Double(earlyHours) != nil
        ) {
            do {
                try await api.opsSetAttendance(
                    employeeId: employeeId,
                    day: NeonFormat.dayKey(day),
                    delayHours: Double(delayHours) ?? 0,
                    earlyHours: Double(earlyHours) ?? 0,
                    note: note
                )
                Toast.success(L("Saved"))
                dismiss()
                await onSaved()
            } catch {
                self.error = error.localizedDescription
            }
        } content: {
            FormSection {
                DateField(L("Day"), date: $day, symbol: "calendar")
                NeonTextField(L("Hours late"), text: $delayHours, symbol: "clock", keyboard: .decimalPad)
                NeonTextField(L("Hours left early"), text: $earlyHours, symbol: "clock.arrow.circlepath", keyboard: .decimalPad)
                NeonTextField(L("Note"), text: $note, symbol: "text.alignleft")
                if let error { ValidationMessage(error) }
            }

            Text(L("Saved by hand, this day is marked Manual and a later device sync will not overwrite it."))
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextTertiary)

            if let recordId {
                NeonButton(L("Remove this record…"), symbol: "trash", kind: .destructive, size: .medium) {
                    confirmRemove = true
                }
                .disabled(removing)
                .confirmDestructive(
                    L("Remove this record?"),
                    message: L("This deletes %@'s figure for this day outright — it is not the same as setting it to zero.", employeeName),
                    actionTitle: L("Remove"),
                    isPresented: $confirmRemove
                ) {
                    Task {
                        removing = true
                        do {
                            try await api.opsDeleteAttendance(id: recordId)
                            Toast.success(L("Removed"))
                            dismiss()
                            await onSaved()
                        } catch {
                            self.error = error.localizedDescription
                            removing = false
                        }
                    }
                }
            }
        }
        .neonSheet([.medium, .large])
    }
}

private func formatHours(_ value: Double?) -> String {
    guard let value, value != 0 else { return "0" }
    return value.truncatingRemainder(dividingBy: 1) == 0 ? String(format: "%.0f", value) : String(value)
}
