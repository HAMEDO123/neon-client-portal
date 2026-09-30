import SwiftUI

// The projects area's own small pieces, built from the kit's tokens. Named
// after the area so they never collide with a kit component.

// MARK: - Pipeline status: one colour and one word each

/// A pipeline status's colour and words, for every place this area shows the
/// pipeline (the list's bar and legend, the cards, the hero, the filter
/// sheet, the edit sheet's menu). There is one map in the app and it is
/// Home's — `HomePipeline` in Features/Home/HomeDashboardCards.swift paints
/// Project Progress — so this reads from it rather than keeping a second
/// one: the same status wears the same colour and the same words
/// ("Sent to Client", the website's, never `localizedEnum`'s "Sent To
/// Client") on both tabs. Change a colour there and both tabs follow.
enum ProjectPipelineStyle {
    static func hue(_ status: String) -> NeonHue {
        HomePipeline.hue(status)
    }

    static func label(_ status: String) -> String {
        HomePipeline.label(status)
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
            Text(ProjectPipelineStyle.label(status))
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

/// Whether the client can see the project, in the kit's publish tone, with a
/// symbol. "Draft" is the pipeline's word; here the same state reads "Not
/// published", which is what it means to the client.
struct ProjectPublishPill: View {
    let state: String
    var onPhoto = false

    var body: some View {
        let tone = publishTone(state)
        HStack(spacing: 4) {
            Image(systemName: ProjectPublishStyle.symbol(state))
                .font(.system(.caption2, weight: .bold))
            Text(ProjectPublishStyle.label(state))
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

/// The same state as a symbol alone, on a card's photo: the status pill
/// under the name is then the only status word on the card.
struct ProjectPublishBadge: View {
    let state: String

    var body: some View {
        Image(systemName: ProjectPublishStyle.symbol(state))
            .font(.system(.footnote, weight: .bold))
            .foregroundStyle(publishTone(state).foreground)
            .frame(width: 28, height: 28)
            .background(Color.white.opacity(0.94), in: Circle())
            .shadow(color: .black.opacity(0.12), radius: 3, x: 0, y: 1)
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(ProjectPublishStyle.label(state)))
    }
}

enum ProjectPublishStyle {
    static func symbol(_ state: String) -> String {
        switch state {
        case "PUBLISHED": return "checkmark.seal.fill"
        case "ARCHIVED": return "archivebox.fill"
        default: return "eye.slash.fill"
        }
    }

    /// "Published", "Not published", "Archived" — never "Draft", which is a
    /// pipeline status and would read as the same thing.
    static func label(_ state: String) -> String {
        switch state {
        case "PUBLISHED": return L("Published")
        case "ARCHIVED": return L("Archived")
        default: return L("Not published")
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
    if minutes < 60 { return projectPlural(minutes, one: "%dm ago", other: "%dm ago") }
    let hours = minutes / 60
    if hours < 24 { return projectPlural(hours, one: "%dh ago", other: "%dh ago") }
    let days = hours / 24
    if days < 30 { return projectPlural(days, one: "%dd ago", other: "%dd ago") }
    // A moment, not a `@db.Date`: shown on the phone's own day.
    return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: AppLanguage.current.locale))
}

// MARK: - Counts with their nouns

/// A count and its noun in the plural form the app's language needs:
/// "1 space", "3 spaces"; in Arabic «مساحة واحدة», «مساحتان», «3 مساحات»,
/// «11 مساحة». English is written here (it has no table); Arabic reads
/// "<other>#zero|one|two|few|many|other" from Projects.strings, falling back
/// to the plain "<other>" key. The form follows the in-app language, not
/// the phone's, which is why this isn't a .stringsdict. `arguments` replace
/// the count as the format's arguments when there are more than one
/// ("%d of %d projects shown" is chosen by its total).
func projectPlural(_ count: Int, one: String, other: String, arguments: [CVarArg]? = nil) -> String {
    let format: String
    if AppLanguage.current == .arabic {
        let key = "\(other)#\(projectArabicPluralCategory(count))"
        let found = L(key)
        format = found == key ? L(other) : found
    } else {
        format = count == 1 ? one : other
    }
    return String(format: format, arguments: arguments ?? [count])
}

/// CLDR's Arabic plural categories.
func projectArabicPluralCategory(_ count: Int) -> String {
    let n = abs(count)
    switch n {
    case 0: return "zero"
    case 1: return "one"
    case 2: return "two"
    default:
        switch n % 100 {
        case 3...10: return "few"
        case 11...99: return "many"
        default: return "other"
        }
    }
}

// MARK: - Area

/// A project's area as the client page and the forms write it. The server
/// keeps free text (the website suggests "320 m²"); a bare number gets its
/// unit, anything else is shown as typed.
func projectAreaText(_ area: String) -> String {
    let trimmed = area.trimmingCharacters(in: .whitespacesAndNewlines)
    guard NeonFormat.parse(trimmed) != nil, !trimmed.contains(where: { $0.isLetter }) else { return trimmed }
    return L("%@ m²", trimmed)
}

/// The number in an area the app wrote ("120 m²", "120"), or nil for text
/// it should leave alone ("300–350", "two floors").
func projectAreaNumber(_ area: String?) -> Double? {
    var text = (area ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    for unit in ["m²", "m2", "sqm", "م²", "م2"] where text.hasSuffix(unit) {
        text = String(text.dropLast(unit.count)).trimmingCharacters(in: .whitespaces)
        break
    }
    guard !text.isEmpty, !text.contains(where: { $0.isLetter }) else { return nil }
    return NeonFormat.parse(text)
}

/// What the area field saves: "120 m²", as the website's own placeholder
/// writes it, so the client's page shows the unit too.
func projectAreaValue(_ value: Double?) -> String {
    guard let value else { return "" }
    return "\(NumberField.editable(value, decimals: 2)) m²"
}

// MARK: - A project's hero

/// The top of a project's page, in the look of the kit's `HeroHeader` (the
/// cover under a dark fade, or the brand wash and a big icon; pulling the
/// page down zooms the photo) with one difference: the name and the client
/// line are sized to their words and sit on the eyebrow's leading edge. The
/// kit's hero fills each line to the card's width and lets a Latin name
/// start from the left, so on an Arabic page the eyebrow and the pills sat
/// on the right and "Watin Cafe" on the left — one header, two edges. Each
/// string still reads in its own direction. The text follows Dynamic Type
/// (`neonDisplay`, `neonSubtitle`), capped so it stays inside the photo.
struct ProjectHero<Accessory: View>: View {
    let title: String
    var subtitle: String?
    var eyebrow: String?
    var imageURL: URL?
    var symbol: String
    var tint: Color
    var height: CGFloat
    let accessory: Accessory

    @State private var baseline: CGFloat?
    @State private var pull: CGFloat = 0

    init(
        _ title: String,
        subtitle: String? = nil,
        eyebrow: String? = nil,
        imageURL: URL? = nil,
        symbol: String = "folder.fill",
        tint: Color = .neonBlueStrong,
        height: CGFloat = 270,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.title = title
        self.subtitle = subtitle
        self.eyebrow = eyebrow
        self.imageURL = imageURL
        self.symbol = symbol
        self.tint = tint
        self.height = height
        self.accessory = accessory()
    }

    var body: some View {
        Group {
            if imageURL != nil {
                photoHero
            } else {
                plainHero
            }
        }
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: ProjectHeroOffsetKey.self, value: proxy.frame(in: .global).minY)
            }
        )
        .onPreferenceChange(ProjectHeroOffsetKey.self) { y in
            if baseline == nil { baseline = y }
            pull = max(0, y - (baseline ?? y))
        }
        .neonAppear(distance: 8)
        .accessibilityElement(children: .contain)
    }

    private func words(onPhoto: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let eyebrow {
                Text(eyebrow.uppercased())
                    .font(.neonOverline.weight(.bold))
                    .tracking(0.8)
                    .foregroundStyle(onPhoto ? Color.white.opacity(0.8) : tint)
            }
            DirText(title, font: .neonDisplay, color: onPhoto ? .white : .neonInk, fill: false, lineLimit: 2)
            if let subtitle {
                DirText(
                    subtitle,
                    font: .neonSubtitle.weight(.medium),
                    color: onPhoto ? .white.opacity(0.85) : .neonTextSecondary,
                    fill: false,
                    lineLimit: 2
                )
            }
            accessory
                .padding(.top, onPhoto ? 4 : 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private var photoHero: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: imageURL)
                .scaleEffect(1 + min(pull, 200) / height, anchor: .bottom)
            LinearGradient(
                colors: [.black.opacity(0), .black.opacity(0.18), .black.opacity(0.72)],
                startPoint: .top,
                endPoint: .bottom
            )
            words(onPhoto: true)
                .padding(20)
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous)
                .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
        )
        .neonShadow(.raised)
    }

    private var plainHero: some View {
        VStack(alignment: .leading, spacing: 10) {
            IconTile(symbol, tint: tint, size: 52, style: .filled)
                .padding(.bottom, 4)
            words(onPhoto: false)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            ZStack {
                LinearGradient.neonAmbient
                Circle()
                    .fill(tint.opacity(0.16))
                    .frame(width: 220, height: 220)
                    .blur(radius: 50)
                    .offset(x: 120, y: -70)
            }
            .clipShape(RoundedRectangle(cornerRadius: NeonRadius.xxl, style: .continuous))
        )
        .neonSurface(.strong, radius: NeonRadius.xxl)
    }
}

private struct ProjectHeroOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
