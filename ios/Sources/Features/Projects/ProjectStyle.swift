import SwiftUI

// The projects area's own small pieces, built from the kit's tokens. Named
// after the area so they never collide with a kit component.

// MARK: - Pipeline status colours

/// A hue for each of the nine pipeline statuses. The kit's `BadgeTone` has
/// seven colours, which would paint three different review states the same
/// orange on the pipeline bar; here every status the list can show side by
/// side gets a colour of its own, and it is the same on the bar, the cards
/// and the hero.
enum ProjectPipelineStyle {
    static func hue(_ status: String) -> NeonHue {
        switch status {
        case "INTERNAL_REVIEW": return .indigo
        case "SENT_TO_CLIENT": return .blue
        case "CLIENT_REVIEWING": return .amber
        case "CHANGES_REQUESTED": return .pink
        case "APPROVED": return .green
        case "EXECUTION": return .cyan
        case "COMPLETED": return .purple
        default: return .grey // DRAFT, ARCHIVED
        }
    }
}

/// A project's pipeline status as a small capsule with a dot. `onPhoto` puts
/// it on an opaque white capsule so it reads over a cover photo; `live`
/// pulses the dot while the project waits on the client or is being built.
struct ProjectStatusPill: View {
    let status: String
    var onPhoto = false
    var live = false

    var body: some View {
        let hue = ProjectPipelineStyle.hue(status)
        HStack(spacing: 5) {
            Circle()
                .fill(hue.color)
                .frame(width: 7, height: 7)
                .background(
                    Circle()
                        .fill(hue.color.opacity(0.35))
                        .frame(width: 7, height: 7)
                        .neonPulse(live && (status == "CLIENT_REVIEWING" || status == "EXECUTION"))
                )
            Text(localizedEnum("pipeline", status))
                .lineLimit(1)
        }
        .font(.system(.caption, weight: .semibold))
        .foregroundStyle(hue.deep)
        .padding(.horizontal, 9)
        .padding(.vertical, 4.5)
        .background(onPhoto ? Color.white.opacity(0.94) : hue.wash, in: Capsule())
        .overlay(Capsule().strokeBorder(hue.deep.opacity(onPhoto ? 0 : 0.14), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Published / Draft / Archived, in the kit's publish tone, with a symbol.
struct ProjectPublishPill: View {
    let state: String
    var onPhoto = false

    var body: some View {
        let tone = publishTone(state)
        HStack(spacing: 4) {
            Image(systemName: ProjectPublishStyle.symbol(state))
                .font(.system(.caption2, weight: .bold))
            Text(localizedEnum("publish", state))
                .lineLimit(1)
        }
        .font(.system(.caption, weight: .semibold))
        .foregroundStyle(tone.foreground)
        .padding(.horizontal, 9)
        .padding(.vertical, 4.5)
        .background(onPhoto ? Color.white.opacity(0.94) : tone.background, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

enum ProjectPublishStyle {
    static func symbol(_ state: String) -> String {
        switch state {
        case "PUBLISHED": return "checkmark.seal.fill"
        case "ARCHIVED": return "archivebox.fill"
        default: return "pencil.circle.fill"
        }
    }
}

/// A journey stage in the studio's words. English has no table, and
/// `localizedEnum` would humanize "BOQ" into "Boq".
func projectStageLabel(_ raw: String) -> String {
    let label = localizedEnum("stage", raw)
    return raw == "BOQ" && label == "Boq" ? L("BOQ") : label
}

// MARK: - On a photo

/// A small frosted label laid over a photo: "Cover", "Before/After", a
/// hotspot count. Dark glass, white text, so it reads on any picture.
struct ProjectPhotoBadge: View {
    let text: String
    var symbol: String?

    var body: some View {
        HStack(spacing: 3) {
            if let symbol {
                Image(systemName: symbol)
                    .font(.system(.caption2, weight: .bold))
            }
            if !text.isEmpty {
                Text(text)
                    .lineLimit(1)
            }
        }
        .font(.system(.caption2, weight: .semibold))
        .monospacedDigit()
        .foregroundStyle(.white)
        .padding(.horizontal, 7)
        .padding(.vertical, 3.5)
        .background(.ultraThinMaterial, in: Capsule())
        .background(Color.black.opacity(0.28), in: Capsule())
        .environment(\.colorScheme, .dark)
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }
}

// MARK: - Action tiles

/// A shortcut tile in the look of the kit's `QuickActionTile` — a filled icon
/// tile on the hue's wash, the label under it — that can also show a spinner
/// while its work runs (sending to WhatsApp takes a moment). Just the label,
/// so it can sit inside a `Button` or a `ShareLink`.
struct ProjectActionTileLabel: View {
    let title: String
    let symbol: String
    let hue: NeonHue
    var isBusy = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        VStack(spacing: 7) {
            ZStack {
                IconTile(symbol, hue: hue, size: 36, style: .filled)
                    .opacity(isBusy ? 0.4 : 1)
                if isBusy {
                    ProgressView()
                        .tint(hue.deep)
                        .transition(.neonPop)
                }
            }
            Text(title)
                .font(.system(.caption, weight: .semibold))
                .foregroundStyle(Color.neonInk.opacity(0.88))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, minHeight: 86)
        .background {
            shape.fill(LinearGradient(colors: [hue.wash.opacity(0.7), hue.wash], startPoint: .top, endPoint: .bottom))
                .overlay(shape.strokeBorder(hue.color.opacity(0.08), lineWidth: 1))
        }
        .contentShape(shape)
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: isBusy)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

struct ProjectActionTile: View {
    let title: String
    let symbol: String
    let hue: NeonHue
    var isBusy = false
    let action: () -> Void

    var body: some View {
        Button {
            Haptic.tap()
            action()
        } label: {
            ProjectActionTileLabel(title: title, symbol: symbol, hue: hue, isBusy: isBusy)
        }
        .buttonStyle(.pressable)
        .disabled(isBusy)
        .accessibilityLabel(Text(title))
    }
}

// MARK: - Hotspot categories

/// The five hotspot categories the website offers (lib/constants.ts). The
/// raw English word is what the server stores; this is how it looks here.
enum ProjectHotspotStyle {
    static func symbol(_ category: String?) -> String {
        switch category {
        case "Material": return "square.stack.3d.up.fill"
        case "Furniture": return "sofa.fill"
        case "Lighting": return "lightbulb.fill"
        case "Drawing": return "pencil.and.ruler.fill"
        default: return "note.text"
        }
    }

    static func hue(_ category: String?) -> NeonHue {
        switch category {
        case "Material": return .orange
        case "Furniture": return .purple
        case "Lighting": return .amber
        case "Drawing": return .blue
        default: return .cyan
        }
    }

    static func label(_ category: String) -> String { localizedEnum("hotspot", category) }
}

/// A numbered hotspot pin: the category's colour, a white ring and a lift.
struct ProjectHotspotPin: View {
    let number: Int
    var category: String?
    var size: CGFloat = 24
    var highlighted = false

    var body: some View {
        let hue = ProjectHotspotStyle.hue(category)
        Text(verbatim: "\(number)")
            .font(.system(size: size * 0.46, weight: .bold))
            .monospacedDigit()
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(hue.fill))
            .overlay(Circle().strokeBorder(Color.white, lineWidth: 2))
            .shadow(color: .black.opacity(0.28), radius: 3, x: 0, y: 1)
            .background(
                Circle()
                    .fill(hue.color.opacity(0.4))
                    .frame(width: size + 10, height: size + 10)
                    .neonPulse(highlighted)
                    .opacity(highlighted ? 1 : 0)
            )
            .scaleEffect(highlighted ? 1.15 : 1)
            .animation(NeonMotion.resolved(NeonMotion.bouncy), value: highlighted)
    }
}

// MARK: - Client activity

/// Activity-log codes (src/lib/activity-labels.ts) in the studio's words: the
/// Arabic from Projects.strings, the English exactly as the website says it.
func projectActivityLabel(_ type: String) -> String {
    let key = "activity.\(type)"
    let translated = L(key)
    if translated != key { return translated }
    let english: [String: String] = [
        "viewed_project": "Opened the project",
        "viewed_render": "Viewed a render",
        "viewed_drawing": "Viewed a drawing",
        "downloaded_drawing": "Downloaded a drawing",
        "downloaded_document": "Downloaded a document",
        "downloaded_image": "Downloaded an image",
        "downloaded_package": "Downloaded the full project package",
        "downloaded_gallery_pdf": "Downloaded the gallery PDF",
        "viewed_boq": "Viewed the BOQ",
        "viewed_pricing": "Viewed pricing",
        "approved": "Approved a design",
        "requested_changes": "Requested changes",
        "commented": "Left a comment",
        "sent_to_client": "Project link sent to client (WhatsApp)",
        "sent_update": "Client notified of an update (WhatsApp)",
    ]
    return english[type] ?? type.replacingOccurrences(of: "_", with: " ").capitalized
}

enum ProjectActivityStyle {
    static func symbol(_ type: String) -> String {
        switch type {
        case "viewed_project": return "eye.fill"
        case "viewed_render": return "photo.fill"
        case "viewed_drawing": return "pencil.and.ruler.fill"
        case "viewed_boq": return "list.number"
        case "viewed_pricing": return "banknote.fill"
        case "approved": return "checkmark.seal.fill"
        case "requested_changes": return "arrow.uturn.backward"
        case "commented": return "bubble.left.fill"
        case "sent_to_client": return "paperplane.fill"
        case "sent_update": return "bell.badge.fill"
        default: return type.hasPrefix("downloaded") ? "arrow.down.to.line" : "circle.fill"
        }
    }

    static func hue(_ type: String) -> NeonHue {
        switch type {
        case "viewed_project": return .blue
        case "viewed_render": return .purple
        case "viewed_drawing", "viewed_boq": return .indigo
        case "viewed_pricing": return .amber
        case "approved", "sent_to_client": return .green
        case "requested_changes": return .pink
        case "commented": return .orange
        case "sent_update": return .cyan
        default: return type.hasPrefix("downloaded") ? .green : .grey
        }
    }
}

/// "just now", "5m ago", "3h ago", "2d ago", then the date.
func projectTimeAgo(_ iso: String?) -> String? {
    guard let date = parseISODate(iso) else { return nil }
    let minutes = Int(-date.timeIntervalSinceNow / 60)
    if minutes < 1 { return L("just now") }
    if minutes < 60 { return L("%dm ago", minutes) }
    let hours = minutes / 60
    if hours < 24 { return L("%dh ago", hours) }
    let days = hours / 24
    if days < 30 { return L("%dd ago", days) }
    // A moment, not a `@db.Date`: shown on the phone's own day.
    return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale))
}
