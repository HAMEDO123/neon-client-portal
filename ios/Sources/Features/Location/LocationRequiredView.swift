import CoreLocation
import SwiftUI

/// Over every screen of somebody on the team while the studio requires
/// location and this phone has not allowed it — Always, and precise. Says
/// what is shared, with whom and when (working hours only), then the one
/// thing to do next: iOS's own question while it will still ask, Settings
/// once it will not.
///
/// Only the screens, as with an outdated build: notifications still arrive,
/// and calls still ring and are answered (the call overlay sits above this).
/// The manager turns the requirement off from the team map's menu.
struct LocationRequiredView: View {
    @ObservedObject var sharing: LocationSharing
    @State private var appeared = false

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                page
                    .frame(minHeight: proxy.size.height)
            }
        }
        .neonAmbientBackground(animated: true)
        .onAppear {
            withNeonAnimation(NeonMotion.smooth) { appeared = true }
        }
        .accessibilityAddTraits(.isModal)
    }

    private var page: some View {
        VStack(spacing: 0) {
            VStack(spacing: 14) {
                ZStack {
                    Circle()
                        .fill(NeonHue.green.wash)
                        .frame(width: 104, height: 104)
                    Circle()
                        .fill(NeonHue.green.pastel)
                        .frame(width: 76, height: 76)
                    Image(systemName: "location.fill")
                        .font(.system(size: 32, weight: .semibold))
                        .foregroundStyle(NeonHue.green.deep)
                }
                .neonFloat()
                Text(L("Location is required"))
                    .font(.neonTitle2.weight(.bold))
                    .foregroundStyle(Color.neonText)
                    .multilineTextAlignment(.center)
                Text(L("The studio asks everybody on the team to share their location during working hours. Allow it to keep using NEON."))
                    .font(.neonBody)
                    .foregroundStyle(Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 20)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 10)

            VStack(spacing: 0) {
                LocationRequiredRow(symbol: "clock.fill", hue: .blue, title: hoursTitle,
                                    detail: L("Never outside working hours, and never after you clock out."))
                NeonDivider().padding(.leading, 52)
                LocationRequiredRow(symbol: "eye.fill", hue: .purple, title: L("Only the manager sees it"),
                                    detail: L("On the team map. Only your latest position is kept, and it is wiped when the day ends."))
                NeonDivider().padding(.leading, 52)
                LocationRequiredRow(symbol: "bell.badge.fill", hue: .orange, title: L("Notifications and calls keep coming"),
                                    detail: L("Even before you allow it."))
            }
            .padding(.vertical, 4)
            .padding(.horizontal, NeonSpace.card)
            .neonSurface(.glass, radius: NeonRadius.lg)
            .padding(.top, 24)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 16)

            steps
                .padding(.top, NeonSpace.lg)

            NeonButton(buttonTitle, symbol: buttonSymbol, kind: .brand) {
                Haptic.tap()
                if goesToSettings { sharing.openSettings() } else { sharing.askPermission() }
            }
            .padding(.top, 22)
            .padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity)
    }

    // MARK: What to do next

    /// Past iOS's own questions: only Settings can change it now.
    private var goesToSettings: Bool {
        switch sharing.authorization {
        case .notDetermined: return false
        case .authorizedWhenInUse: return !sharing.canAskForAlways
        case .authorizedAlways: return true // allowed, but not precise
        default: return true
        }
    }

    private var buttonTitle: String {
        if goesToSettings { return L("Open Settings") }
        return sharing.authorization == .notDetermined ? L("Allow location") : L("Allow Always")
    }

    private var buttonSymbol: String {
        goesToSettings ? "gearshape.fill" : "location.fill"
    }

    @ViewBuilder
    private var steps: some View {
        let lines = stepLines
        VStack(alignment: .leading, spacing: 10) {
            Text(stepsTitle)
                .font(.neonSubheadline.weight(.semibold))
                .foregroundStyle(Color.neonText)
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                HStack(alignment: .top, spacing: 10) {
                    Text(verbatim: "\(index + 1)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 22, height: 22)
                        .background(Circle().fill(Color.neonPurpleStrong))
                    Text(line)
                        .font(.neonSubheadline)
                        .foregroundStyle(Color.neonTextSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
            }
            if sharing.authorization == .denied {
                Text(L("If Location Services is off for the whole phone: Settings → Privacy & Security → Location Services."))
                    .font(.neonFootnote)
                    .foregroundStyle(Color.neonTextTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(NeonSpace.card)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous).fill(NeonHue.purple.wash))
    }

    private var stepsTitle: String {
        goesToSettings ? L("In Settings → NEON → Location:") : L("iPhone will ask you:")
    }

    private var stepLines: [String] {
        switch sharing.authorization {
        case .notDetermined:
            return [L("Choose “Allow While Using App”."), L("Then choose “Change to Always Allow”.")]
        case .authorizedWhenInUse where sharing.canAskForAlways:
            return [L("Choose “Change to Always Allow”.")]
        case .authorizedAlways:
            return [L("Turn on Precise Location.")]
        default:
            return [L("Choose “Always”."), L("Turn on Precise Location."), L("Come back to NEON.")]
        }
    }

    private var hoursTitle: String {
        if let plan = sharing.plan, let starts = plan.starts, let ends = plan.ends {
            return L("Working hours only · %@ – %@", locationClock(starts), locationClock(ends))
        }
        return L("Working hours only")
    }
}

private struct LocationRequiredRow: View {
    let symbol: String
    let hue: NeonHue
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            IconTile(symbol, hue: hue, size: NeonSize.iconTile, style: .soft)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.neonRowTitle)
                    .foregroundStyle(Color.neonText)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.neonSubtitle)
                    .foregroundStyle(Color.neonTextSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}
