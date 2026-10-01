import SwiftUI
import UIKit

// Somebody's picture, full screen, WhatsApp's way: tap the picture or the
// name at the top of a conversation — or a sender's small face beside their
// message in a group — and their photo fills a black page, with their name
// over it. Pinch or double-tap to zoom, drag to look around while zoomed,
// swipe it away up or down, or Close. Somebody with no photo is shown their
// large initials on their own colour (a group, its glyph; the team, the
// studio's mark) rather than nothing. Anything the conversation's header led
// to before — a group's info — is a button on the page.

/// Something more about whoever is shown, one tap away on the page — a
/// group's info. The viewer closes first; the presenter acts once it has gone.
struct ChatFaceAction {
    let title: String
    let symbol: String
    let perform: () -> Void
}

/// Whose picture to show.
struct ChatFacePayload: Identifiable {
    let id = UUID()
    let name: String
    /// The line under the name: online now, last seen, how many in the group.
    var subtitle: String?
    /// The face as the server sent it — a photo, the server's initials picture
    /// (`/api/avatar?…`, read for its colour), or the studio's icon.
    let url: URL?
    /// Their colour, where the conversation knows it (ChatRoomPalette).
    var color: String?
    var isGroup = false
    /// The team: the studio's own mark.
    var studioMark = false
    var action: ChatFaceAction?

    /// A real photo to show, or nil for initials (or a glyph, or the mark).
    var photoURL: URL? {
        if studioMark { return nil }
        if isGroup && ChatFace.isStudioIcon(url) { return nil }
        return ChatFace(url: url, color: color).photo
    }
}

struct ChatFaceViewer: View {
    let payload: ChatFacePayload

    @Environment(\.dismiss) private var dismiss

    @State private var chromeHidden = false
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    /// How far it has been dragged towards being swiped away.
    @State private var pull: CGFloat = 0
    @State private var photo: UIImage?
    @State private var photoFailed = false

    /// The size the photo is fetched at: the largest the server keeps.
    private static let fullPixels: CGFloat = 1600

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.black
                    .opacity(backdropOpacity)
                    .ignoresSafeArea()

                face(in: geo.size)
                    .scaleEffect(scale)
                    .offset(x: offset.width, y: offset.height + pull)
                    .frame(width: geo.size.width, height: geo.size.height)
                    .contentShape(Rectangle())
                    .gesture(pinch.simultaneously(with: drag))
                    .onTapGesture(count: 2) { toggleZoom() }
                    .onTapGesture(count: 1) {
                        withNeonAnimation(NeonMotion.quick) { chromeHidden.toggle() }
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(payload.photoURL == nil ? Text(verbatim: payload.name) : Text(L("Photo of %@", payload.name)))
                    .accessibilityAddTraits(.isImage)

                if !chromeHidden {
                    chrome
                        .opacity(pull == 0 ? 1 : max(0, 1 - abs(pull) / 160))
                        .transition(.opacity)
                }
            }
        }
        .statusBarHidden(chromeHidden)
        // The app is light; on this black page the status bar's glyphs must
        // be white. Applies to the viewer's own presentation only.
        .preferredColorScheme(.dark)
        .task(id: payload.photoURL) { await loadPhoto() }
    }

    private var backdropOpacity: Double {
        max(0.25, 1 - Double(abs(pull)) / 420)
    }

    // MARK: The face

    @ViewBuilder
    private func face(in size: CGSize) -> some View {
        let side = min(size.width, size.height)
        if let url = payload.photoURL {
            if let shown = photo ?? Self.smallerCopy(url) {
                Image(uiImage: shown)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: size.width, maxHeight: size.height)
                    .overlay(alignment: .bottom) {
                        if photo == nil && !photoFailed {
                            ProgressView()
                                .tint(.white)
                                .padding(10)
                                .background(.ultraThinMaterial, in: Circle())
                                .environment(\.colorScheme, .dark)
                                .padding(.bottom, 16)
                        }
                    }
                    .transition(.opacity)
            } else {
                // Their initials until the photo arrives — or for good, if it cannot.
                initials(side: side)
                    .overlay {
                        if !photoFailed {
                            ProgressView().tint(.white).controlSize(.large)
                        }
                    }
            }
        } else {
            initials(side: side)
        }
    }

    @ViewBuilder
    private func initials(side: CGFloat) -> some View {
        if payload.studioMark {
            ChatStudioMark(size: side * 0.62)
        } else {
            ChatAvatar(
                // Only the server's initials picture, for the colour it carries.
                url: payload.url?.path == "/api/avatar" ? payload.url : nil,
                name: payload.name,
                size: side * 0.72,
                color: payload.color,
                isGroup: payload.isGroup
            )
        }
    }

    /// The largest smaller copy already in memory — the header's own small
    /// picture — to show at once, sharpening when the full one arrives.
    private static func smallerCopy(_ url: URL) -> UIImage? {
        if let full = ImagePipeline.shared.cached(url, pixels: fullPixels) { return full }
        for width in ImagePipeline.widths.reversed() where CGFloat(width) < fullPixels {
            if let copy = ImagePipeline.shared.cached(url, pixels: CGFloat(width)) { return copy }
        }
        return nil
    }

    private func loadPhoto() async {
        guard let url = payload.photoURL else { return }
        if let cached = ImagePipeline.shared.cached(url, pixels: Self.fullPixels) {
            photo = cached
            return
        }
        let loaded = await ImagePipeline.shared.image(url, pixels: Self.fullPixels)
        guard !Task.isCancelled else { return }
        withNeonAnimation(NeonMotion.gentle) {
            photo = loaded
            photoFailed = loaded == nil
        }
    }

    // MARK: Chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                IconButton("xmark", label: L("Close"), tint: .white, size: 40) { dismiss() }
                VStack(alignment: .leading, spacing: 1) {
                    DirText(payload.name, font: .system(.headline, weight: .semibold), color: .white, fill: false, lineLimit: 1)
                    if let subtitle = payload.subtitle, !subtitle.isEmpty {
                        DirText(subtitle, font: .system(.caption, weight: .medium), color: .white.opacity(0.7), fill: false, lineLimit: 1)
                    }
                }
                Spacer(minLength: 8)
            }
            .padding(.horizontal, NeonSpace.gutter)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .background(
                LinearGradient(colors: [.black.opacity(0.55), .black.opacity(0)], startPoint: .top, endPoint: .bottom)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            )

            Spacer(minLength: 0)

            if let action = payload.action {
                Button {
                    Haptic.tap()
                    action.perform()
                    dismiss()
                } label: {
                    Label(action.title, systemImage: action.symbol)
                        .font(.system(.subheadline, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 18)
                        .frame(minHeight: NeonSize.touch)
                        .background(.ultraThinMaterial, in: Capsule())
                        .overlay(Capsule().strokeBorder(Color.white.opacity(0.25), lineWidth: 0.75))
                        .environment(\.colorScheme, .dark)
                        .contentShape(Capsule())
                }
                .buttonStyle(.pressable)
                .padding(.bottom, 16)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    // MARK: Gestures

    private var pinch: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                scale = max(1, min(5, lastScale * value))
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.02 {
                    withNeonAnimation(NeonMotion.smooth) { resetZoom() }
                }
            }
    }

    /// Zoomed in, a drag looks around; at its own size, a drag up or down
    /// takes the page with it, and far or fast enough sends it away.
    private var drag: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                if scale > 1 {
                    offset = CGSize(
                        width: lastOffset.width + value.translation.width,
                        height: lastOffset.height + value.translation.height
                    )
                } else {
                    pull = value.translation.height
                }
            }
            .onEnded { value in
                if scale > 1 {
                    lastOffset = offset
                    return
                }
                let flung = abs(value.predictedEndTranslation.height) > 420
                if abs(pull) > 130 || flung {
                    Haptic.soft()
                    dismiss()
                } else {
                    withNeonAnimation(NeonMotion.snappy) { pull = 0 }
                }
            }
    }

    private func toggleZoom() {
        withNeonAnimation(NeonMotion.smooth) {
            if scale > 1 {
                resetZoom()
            } else {
                scale = 2.5
                lastScale = 2.5
            }
        }
    }

    private func resetZoom() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}
