import SwiftUI

/// One person's day, as the manager says it was: hours late, hours left
/// early, a note, and every time they stepped out and came back — or the
/// day's record taken away. The app's copy of the website's cell editor
/// (components/admin/attendance-cell.tsx), on the same two actions,
/// `editAttendanceDay` and `removeAttendanceDay` in operations-actions.ts.
///
/// Opened from any day that has happened, with or without a record. The
/// server's rules travel with the call unchanged: saving makes the day MANUAL
/// so the device never writes over it again, the hours are held to 0–24, and
/// times out that overlap or come back before they left are refused in a
/// sentence, which is shown here as it arrives.
struct AttendanceCorrectionSheet: View {
    let employeeId: String
    let employeeName: String
    let dayKey: String
    /// What is recorded now; nil for a day with nothing on it.
    let entry: AttendanceMonth.Entry?
    /// Today is still running: saving it also means its clock-out will not be
    /// recorded, which the sheet has to say before somebody saves.
    let isToday: Bool
    let onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var delayHours: Double
    @State private var earlyHours: Double
    @State private var note: String
    @State private var breaks: [BreakDraft]
    @State private var error: String?
    @State private var confirmRemove = false
    @State private var removing = false

    init(
        employeeId: String,
        employeeName: String,
        dayKey: String,
        entry: AttendanceMonth.Entry? = nil,
        isToday: Bool = false,
        onSaved: @escaping () async -> Void
    ) {
        self.employeeId = employeeId
        self.employeeName = employeeName
        self.dayKey = dayKey
        self.entry = entry
        self.isToday = isToday
        self.onSaved = onSaved
        _delayHours = State(initialValue: entry?.delayHours ?? 0)
        _earlyHours = State(initialValue: entry?.earlyHours ?? 0)
        _note = State(initialValue: entry?.note ?? "")
        _breaks = State(initialValue: (entry?.breaks ?? []).map(BreakDraft.init(stored:)))
    }

    var body: some View {
        SheetScaffold(
            employeeName,
            subtitle: dayLabel,
            symbol: "clock.badge.exclamationmark",
            primaryTitle: L("Save"),
            isPrimaryEnabled: hoursAreValid && !removing
        ) {
            await save()
        } content: {
            // Its own reader inside the scaffold's scroll view, so a debug
            // launch can show the bottom of the sheet (`-neonScroll remove`).
            ScrollViewReader { proxy in
                fields.debugScroll(proxy)
            }
        }
        .neonSheet([.large])
    }

    @ViewBuilder
    private var fields: some View {
        VStack(alignment: .leading, spacing: 18) {
            StatusNote(
                symbol: entry == nil ? "calendar" : "calendar.badge.clock",
                tone: .neutral,
                title: entry == nil ? L("Nothing is recorded for this day.") : L("Recorded now"),
                detail: entry.map(nowLine)
            )

            // Said at the top, before anything is changed: the next sync
            // leaves this day alone, and on a day still running that includes
            // the clock-out the device would otherwise have recorded tonight.
            StatusNote(
                symbol: "hand.raised.fill",
                tone: isToday ? .warning : .info,
                title: L("Saved by hand, this day becomes Manual."),
                detail: isToday
                    ? L("Each hour is taken off their pay at their hourly rate. This is today: once you save, the device no longer changes this day — and their clock-out tonight will not be recorded.")
                    : L("Each hour is taken off their pay at their hourly rate. Once you save, the device no longer changes this day.")
            )

            FormSection {
                HStack(alignment: .top, spacing: NeonSpace.md) {
                    NumberField(L("Hours late"), value: $delayHours, unit: L("h"), symbol: "clock")
                    NumberField(L("Hours left early"), value: $earlyHours, unit: L("h"), symbol: "clock.arrow.circlepath")
                }
                if !hoursAreValid {
                    ValidationMessage(L("Hours are a number from 0 to 24."))
                }
            }

            FormSection(L("Stepped out and came back")) {
                ForEach($breaks) { $item in
                    BreakRow(number: (breaks.firstIndex { $0.id == item.id } ?? 0) + 1, item: $item) {
                        Haptic.tap()
                        withNeonAnimation { breaks.removeAll { $0.id == item.id } }
                        error = nil
                    }
                    .transition(.neonPop)
                }

                Button {
                    Haptic.tap()
                    withNeonAnimation { breaks.append(BreakDraft.after(breaks.last)) }
                } label: {
                    Label(L("Add a clock-out and clock-in"), systemImage: "plus")
                }
                .buttonStyle(.neon(.secondary, size: .medium))

                if awayMinutes > 0 {
                    Text(L("Out %@ in all — the time away is rounded up to whole hours, as lateness is.", describeMinutes(Double(awayHoursCharged * 60))))
                        .font(.neonFootnote)
                        .foregroundStyle(Color.neonTextSecondary)
                }
            }

            FormSection {
                NeonTextEditor(L("Note (optional)"), text: $note, minLines: 2, maxLines: 4, limit: 200)
            }

            if let error {
                ValidationMessage(error)
                    .id("error")
            }

            if entry != nil {
                NeonButton(L("Remove this day's record…"), symbol: "trash", kind: .destructive, size: .medium) {
                    confirmRemove = true
                }
                .disabled(removing)
                .id("remove")
                .confirmDestructive(
                    L("Remove %@'s record for %@?", employeeName, dayLabel),
                    message: isToday
                        ? L("This deletes the day outright — it is not the same as setting it to zero. On today, the device records it again at its next read.")
                        : L("This deletes the day outright — it is not the same as setting it to zero."),
                    actionTitle: L("Remove"),
                    isPresented: $confirmRemove
                ) {
                    Task { await remove() }
                }
            }
        }
    }

    // MARK: - Actions

    private func save() async {
        error = nil
        do {
            try await api.opsEditAttendanceDay(
                employeeId: employeeId,
                day: dayKey,
                delayHours: delayHours,
                earlyHours: earlyHours,
                note: note.trimmingCharacters(in: .whitespacesAndNewlines),
                breaks: breaks.map(\.stored)
            )
            Haptic.success()
            Toast.success(L("Saved"))
            dismiss()
            await onSaved()
        } catch {
            // The server's own sentence — "Two of those times out overlap."
            // — is what `APIError.refused` carries; show it as it came.
            Haptic.error()
            self.error = error.localizedDescription
        }
    }

    private func remove() async {
        removing = true
        error = nil
        do {
            try await api.opsRemoveAttendanceDay(employeeId: employeeId, day: dayKey)
            Toast.success(L("Removed"))
            dismiss()
            await onSaved()
        } catch {
            self.error = error.localizedDescription
            removing = false
        }
    }

    // MARK: - Reading

    private var hoursAreValid: Bool {
        (0...24).contains(delayHours) && (0...24).contains(earlyHours)
    }

    /// Only rows that make sense count towards the line under them, as the
    /// website's total does; the server judges the rest when it is saved.
    private var awayMinutes: Int {
        breaks.compactMap(\.minutes).reduce(0, +)
    }

    /// Whole hours, rounded up — `awayHoursOf` in attendance-breaks.ts.
    private var awayHoursCharged: Int {
        awayMinutes > 0 ? Int((Double(awayMinutes) / 60).rounded(.up)) : 0
    }

    /// "Saturday 24 October" — the day as the studio's calendar writes it;
    /// the key is UTC midnight of it, so it is read in UTC.
    private var dayLabel: String {
        guard let date = parseISODate("\(dayKey)T00:00:00.000Z") else { return dayKey }
        var style = Date.FormatStyle(date: .omitted, time: .omitted, locale: AppLanguage.current.locale)
            .weekday(.wide).day().month(.wide)
        style.timeZone = TimeZone(identifier: "UTC")!
        return date.formatted(style)
    }

    /// The website's "Now: 1h late · 0h left early · out 13:00–13:40 · set by
    /// you", in the app's own hour format.
    private func nowLine(_ entry: AttendanceMonth.Entry) -> String {
        var parts: [String] = []
        parts.append(entry.delayHours > 0 ? L("Late %@", describeMinutes(entry.delayHours * 60)) : L("Not late"))
        if let early = entry.earlyHours, early > 0 { parts.append(L("Left early %@", describeMinutes(early * 60))) }
        if let line = attendanceBreaksLine(entry) { parts.append(line) }
        if entry.clockedOut == false { parts.append(L("no clock-out")) }
        parts.append(attendanceSourceLabel(entry.source))
        return parts.joined(separator: " · ")
    }
}

/// One "out at — back at" row being edited. Held as two times of day with an
/// id of its own, so removing one row never moves what was typed in another.
private struct BreakDraft: Identifiable, Equatable {
    let id = UUID()
    var out: Date
    var back: Date

    init(out: Date, back: Date) {
        self.out = out
        self.back = back
    }

    init(stored: AttendanceMonth.Break) {
        out = attendanceTimeToDate(stored.out)
        back = attendanceTimeToDate(stored.back)
    }

    /// A new row starts where the last one came back (or at one o'clock),
    /// half an hour long — something to adjust, never a guess that is saved
    /// without being looked at, since the row is on screen until Save.
    static func after(_ previous: BreakDraft?) -> BreakDraft {
        let start = previous?.back ?? attendanceTimeToDate("13:00")
        return BreakDraft(out: start, back: start.addingTimeInterval(30 * 60))
    }

    var stored: AttendanceMonth.Break {
        AttendanceMonth.Break(out: attendanceDateToTime(out), back: attendanceDateToTime(back))
    }

    /// Minutes away, or nil when the time back is not after the time out.
    var minutes: Int? {
        guard let from = minutesOfTime(attendanceDateToTime(out)), let to = minutesOfTime(attendanceDateToTime(back)), to > from else {
            return nil
        }
        return to - from
    }
}

/// One time out: its number and a way to take it off on the first line, the
/// two times side by side under it. The remove button has a line of its own
/// because two time pickers and a 44-point button do not fit across a phone
/// in English ("12:30 PM" is wide) — the row ran off the screen.
private struct BreakRow: View {
    let number: Int
    @Binding var item: BreakDraft
    let onRemove: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: NeonSpace.sm) {
                Text(L("Time out %d", number))
                    .font(.system(.footnote, weight: .semibold))
                    .foregroundStyle(Color.neonTextSecondary)
                Spacer(minLength: 0)
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Color.neonTextFaint)
                        .frame(width: NeonSize.touch, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("Remove this time out"))
            }
            HStack(alignment: .top, spacing: NeonSpace.md) {
                BreakTimeField(label: L("Out at"), time: $item.out)
                BreakTimeField(label: L("Back at"), time: $item.back)
            }
            if item.minutes == nil {
                ValidationMessage(L("They came back after they left: the time back has to be later."), tone: .warning)
            }
        }
    }
}

/// The kit's `TimeField` without its clock glyph: two of them have to share
/// a phone's width, and the glyph is the part that did not fit.
private struct BreakTimeField: View {
    let label: String
    @Binding var time: Date

    var body: some View {
        FormField(label) {
            HStack(spacing: 0) {
                DatePicker(label, selection: $time, displayedComponents: .hourAndMinute)
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .tint(.neonPurpleStrong)
                    .fixedSize()
                Spacer(minLength: 0)
            }
            .fieldChrome()
        }
    }
}

// MARK: - "HH:MM" ⇄ Date, for the time pickers

/// A time of day on today's date in this phone's calendar — only the hour
/// and minute are ever read back, by `attendanceDateToTime`, in the same one.
func attendanceTimeToDate(_ time: String) -> Date {
    let minutes = minutesOfTime(time) ?? 0
    var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
    components.hour = minutes / 60
    components.minute = minutes % 60
    return Calendar.current.date(from: components) ?? Date()
}

func attendanceDateToTime(_ date: Date) -> String {
    let components = Calendar.current.dateComponents([.hour, .minute], from: date)
    return String(format: "%02d:%02d", components.hour ?? 0, components.minute ?? 0)
}
