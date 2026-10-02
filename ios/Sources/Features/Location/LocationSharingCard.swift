import CoreLocation
import SwiftUI

/// On the team's Today page: whether this phone shares its location with the
/// studio right now, until when, and — before anything is shared — what is
/// shared, with whom and when, with the one button that asks iOS. Somebody
/// is never shared without seeing it here first.
struct LocationSharingCard: View {
    @ObservedObject var sharing: LocationSharing

    @MainActor init() {
        self.init(sharing: .shared)
    }

    init(sharing: LocationSharing) {
        self.sharing = sharing
    }

    var body: some View {
        Group {
            switch sharing.authorization {
            case .notDetermined: askCard
            case .denied, .restricted: offCard
            default: onCard
            }
        }
        .animation(NeonMotion.resolved(NeonMotion.smooth), value: sharing.authorization)
        .animation(NeonMotion.resolved(NeonMotion.smooth), value: sharing.isRunning)
    }

    // MARK: Not asked yet

    private var askCard: some View {
        SectionCard(L("Your location during work hours"), subtitle: hoursLine, symbol: "location.fill", hue: .green) {
            VStack(alignment: .leading, spacing: NeonSpace.md) {
                Text(L("The manager sees where you are on the team map while the working day is on. Nothing is shared outside working hours, or after you clock out."))
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                fineNote
                NeonButton(L("Turn on location"), symbol: "location.fill", size: .medium) {
                    Haptic.tap()
                    sharing.askPermission()
                }
            }
        }
    }

    // MARK: Turned off

    private var offCard: some View {
        SectionCard(L("Location is off"), subtitle: L("The team map shows the manager that it is off"), symbol: "location.slash.fill", hue: .orange) {
            VStack(alignment: .leading, spacing: NeonSpace.md) {
                Text(L("Turn it on in Settings → NEON → Location. It is only shared during working hours."))
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                fineNote
                NeonButton(L("Open Settings"), symbol: "gearshape.fill", kind: .secondary, size: .medium) {
                    sharing.openSettings()
                }
            }
        }
    }

    // MARK: Allowed

    @ViewBuilder
    private var onCard: some View {
        if sharing.isRunning {
            SectionCard(L("Sharing your location"), subtitle: untilLine, symbol: "location.fill", hue: .green) {
                notes
            } trailing: {
                LocationLiveDot()
            }
        } else {
            SectionCard(L("Location sharing"), subtitle: restingLine, symbol: "location", hue: .grey) {
                notes
            }
        }
    }

    @ViewBuilder
    private var notes: some View {
        let whileOpenOnly = sharing.authorization == .authorizedWhenInUse
        if whileOpenOnly || !sharing.precise || fineShows {
            VStack(alignment: .leading, spacing: NeonSpace.sm) {
                fineNote
                if whileOpenOnly {
                    StatusNote(
                        symbol: "iphone",
                        tone: .info,
                        title: L("Only while NEON is open"),
                        detail: L("Choose Always so it carries on with the app closed — still during working hours only.")
                    )
                }
                if !sharing.precise {
                    StatusNote(
                        symbol: "scope",
                        tone: .warning,
                        title: L("Precise Location is off"),
                        detail: L("The map shows only roughly where you are.")
                    )
                }
                if whileOpenOnly || !sharing.precise {
                    NeonButton(whileOpenOnly ? L("Allow Always") : L("Open Settings"), symbol: "location.fill", kind: .secondary, size: .medium) {
                        if whileOpenOnly { sharing.askPermission() } else { sharing.openSettings() }
                    }
                }
            }
        }
    }

    // MARK: 1 JOD a day without location

    private var fine: LocationFine? {
        guard let fine = sharing.plan?.fine, fine.on else { return nil }
        return fine
    }

    private var fineShows: Bool { fine != nil }

    /// The rule, and where today stands against it: told before it starts,
    /// then today's answer, then what this month has cost.
    @ViewBuilder
    private var fineNote: some View {
        if let fine, let plan = sharing.plan {
            let charged = plan.finedThisMonth ?? []
            VStack(alignment: .leading, spacing: NeonSpace.sm) {
                if let startsOn = fine.startsOn, startsOn > NeonFormat.dayKey(Date()) {
                    StatusNote(
                        symbol: "banknote.fill",
                        tone: .warning,
                        title: L("From %@, a working day without location costs %@", formattedDayKey(startsOn), fine.amountText),
                        detail: L("Only days the fingerprint device sees you arrive. You are warned during the day first.")
                    )
                } else if plan.sharedToday == true {
                    StatusNote(symbol: "checkmark.seal.fill", tone: .success, title: L("Today's location reached NEON"))
                } else if fine.startsOn != nil, plan.sharing {
                    StatusNote(
                        symbol: "exclamationmark.triangle.fill",
                        tone: .danger,
                        title: L("No location has reached NEON today"),
                        detail: L("A working day without it costs %@. Keep NEON's location on.", fine.amountText)
                    )
                }
                if !charged.isEmpty {
                    StatusNote(
                        symbol: "banknote",
                        tone: .danger,
                        title: L("This month: %@ for %d days without location", NeonFormat.money(fine.amount * Double(charged.count), decimals: 0), charged.count),
                        detail: charged.map(formattedDayKey).joined(separator: L(", "))
                    )
                }
            }
        }
    }

    // MARK: Words

    private var hoursLine: String? {
        guard let plan = sharing.plan, let starts = plan.starts, let ends = plan.ends else { return nil }
        return L("Working hours %@ – %@", locationClock(starts), locationClock(ends))
    }

    private var untilLine: String {
        var line = sharing.plan?.ends.map { L("Until %@ · on the team map", locationClock($0)) } ?? L("On the team map")
        if let sent = sharing.lastSentAt {
            line += " · " + L("sent %@", locationAgo(sent))
        }
        return line
    }

    private var restingLine: String {
        guard let plan = sharing.plan else { return L("Shared during working hours only") }
        switch plan.reason {
        case "before-hours":
            return plan.starts.map { L("Starts at %@ — nothing is shared before then", locationClock($0)) }
                ?? L("Shared during working hours only")
        case "clocked-out":
            return L("Stopped — you clocked out")
        case "day-off":
            return L("Not shared on a day off")
        default:
            if let next = plan.nextStart {
                return L("Not shared outside working hours · starts %@", locationClock(next))
            }
            return L("Not shared outside working hours")
        }
    }
}

/// A small pulsing green dot: on, now.
struct LocationLiveDot: View {
    var body: some View {
        Circle()
            .fill(Color.neonSuccess)
            .frame(width: 10, height: 10)
            .neonPulse(true)
            .padding(6)
            .accessibilityLabel(Text(L("On")))
    }
}
