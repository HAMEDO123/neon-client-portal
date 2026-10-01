import SwiftUI

/// The photo after it is taken or picked, as WhatsApp lays it out: the photo
/// filling the screen; ✕ and a row of round tools along the top — save to
/// Photos, HD, crop and turn, stickers, text, the pencil; and at the foot the
/// caption, the chat it goes to and the green send button.
///
/// Stickers and text are dragged with one finger, and pinched and turned with
/// two (the one last touched); dragging one onto the bin at the foot takes it
/// off. Everything is burned into the photo when it is saved or sent.
struct ChatPhotoEditor: View {
    @ObservedObject var model: ChatPhotoEditModel
    let chatName: String
    @Binding var caption: String
    /// ✕: this photo is put away.
    let onClose: () -> Void
    /// The camera in the caption box: take another instead.
    let onRetake: () -> Void
    let onSend: (UploadFile) -> Void
    /// A tool already out when it opens (the debug router's screenshots).
    var opening: Opening?
    /// For a story: no caption, chat or HD — a Next button hands back the
    /// photo with everything burned in, for the story composer.
    var forStory: ((UIImage) -> Void)?

    enum Opening {
        case stickers
        case text(String)
    }

    @State private var showStickers = false
    @State private var textDraft: ChatEditTextDraft?
    /// The sticker or text a two-finger pinch acts on: the one last touched.
    @State private var active: UUID?
    @State private var dragging: UUID?
    @State private var dragStart: CGPoint?
    @State private var overTrash = false
    @State private var trashFrame: CGRect = .zero
    @State private var pinchStart: (scale: CGFloat, rotation: Angle)?
    @State private var liveStroke: ChatEditStroke?
    @State private var sending = false
    @State private var saving = false
    @FocusState private var captionFocused: Bool

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            canvas
                .ignoresSafeArea()

            if model.tool == .crop {
                ChatCropView(image: model.image) {
                    withNeonAnimation(NeonMotion.quick) { model.tool = nil }
                } onDone: { rect, turns in
                    model.applyCrop(rect: rect, quarterTurns: turns)
                    withNeonAnimation(NeonMotion.quick) { model.tool = nil }
                }
                .transition(.opacity)
            } else if textDraft == nil {
                chrome
                    .transition(.opacity)
            }

            if textDraft != nil {
                ChatEditTextEntry(draft: $textDraft) { finished in
                    commitText(finished)
                }
                .transition(.opacity)
            }
        }
        .animation(NeonMotion.resolved(NeonMotion.quick), value: model.tool)
        .animation(NeonMotion.resolved(NeonMotion.quick), value: textDraft == nil)
        .animation(NeonMotion.resolved(NeonMotion.quick), value: dragging == nil)
        .onAppear {
            switch opening {
            case .stickers: showStickers = true
            case .text(let words): textDraft = ChatEditTextDraft(id: UUID(), text: words, color: 4, boxed: false, isNew: true)
            case nil: break
            }
        }
        .sheet(isPresented: $showStickers) {
            ChatStickerSheet { emoji in
                let sticker = ChatEditOverlay(kind: .emoji(emoji))
                model.overlays.append(sticker)
                active = sticker.id
            }
            .preferredColorScheme(.light)
        }
    }

    // MARK: The picture

    private var canvas: some View {
        GeometryReader { geo in
            let frame = Self.fit(aspect: model.aspect, in: geo.size)
            ZStack(alignment: .topLeading) {
                Image(uiImage: model.image)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: frame.width, height: frame.height)
                    .accessibilityLabel(L("Photo"))

                Canvas { context, size in
                    let all = model.strokes + (liveStroke.map { [$0] } ?? [])
                    for stroke in all {
                        let path = ChatPhotoEditModel.path(stroke.points, in: CGRect(origin: .zero, size: size))
                        context.stroke(
                            path,
                            with: .color(Color(ChatEditPalette.color(stroke.color))),
                            style: StrokeStyle(lineWidth: max(1, stroke.width * size.width), lineCap: .round, lineJoin: .round)
                        )
                    }
                }
                .frame(width: frame.width, height: frame.height)
                .allowsHitTesting(false)

                ForEach(model.overlays) { overlay in
                    overlayView(overlay, in: frame.size)
                }
            }
            .frame(width: frame.width, height: frame.height)
            .clipped()
            .contentShape(Rectangle())
            .gesture(drawGesture(in: frame.size), including: model.tool == .draw ? .all : .subviews)
            .position(x: frame.midX, y: frame.midY)
        }
        .contentShape(Rectangle())
        .simultaneousGesture(pinchGesture, including: model.tool == nil && textDraft == nil ? .all : .subviews)
        // A photo is never mirrored, in Arabic either.
        .environment(\.layoutDirection, .leftToRight)
    }

    /// The largest rectangle of the picture's shape inside the screen, centred.
    static func fit(aspect: CGFloat, in size: CGSize) -> CGRect {
        guard size.width > 0, size.height > 0, aspect > 0 else { return CGRect(origin: .zero, size: size) }
        var width = size.width
        var height = width / aspect
        if height > size.height {
            height = size.height
            width = height * aspect
        }
        return CGRect(x: (size.width - width) / 2, y: (size.height - height) / 2, width: width, height: height)
    }

    private func overlayView(_ overlay: ChatEditOverlay, in size: CGSize) -> some View {
        let isDragged = dragging == overlay.id
        return ChatEditOverlayLabel(overlay: overlay, pictureWidth: size.width)
            .rotationEffect(overlay.rotation)
            .scaleEffect(isDragged && overTrash ? 0.45 : 1)
            .opacity(textDraft?.id == overlay.id ? 0 : (isDragged && overTrash ? 0.6 : 1))
            .contentShape(Rectangle())
            .gesture(dragGesture(for: overlay, in: size))
            .onTapGesture {
                active = overlay.id
                if case .text = overlay.kind { beginText(editing: overlay) }
            }
            .position(x: overlay.center.x * size.width, y: overlay.center.y * size.height)
            .allowsHitTesting(model.tool == nil)
            .accessibilityLabel(overlayLabel(overlay))
    }

    private func overlayLabel(_ overlay: ChatEditOverlay) -> String {
        switch overlay.kind {
        case .emoji(let emoji): return L("Sticker %@", emoji)
        case .text(let text): return L("Text: %@", text)
        }
    }

    // MARK: Gestures

    private func dragGesture(for overlay: ChatEditOverlay, in size: CGSize) -> some Gesture {
        DragGesture(coordinateSpace: .global)
            .onChanged { value in
                guard let index = model.overlays.firstIndex(where: { $0.id == overlay.id }) else { return }
                if dragging != overlay.id {
                    dragging = overlay.id
                    active = overlay.id
                    dragStart = model.overlays[index].center
                }
                guard let start = dragStart else { return }
                model.overlays[index].center = CGPoint(
                    x: start.x + value.translation.width / max(size.width, 1),
                    y: start.y + value.translation.height / max(size.height, 1)
                )
                let over = trashFrame.insetBy(dx: -18, dy: -18).contains(value.location)
                if over != overTrash {
                    overTrash = over
                    Haptic.selection()
                }
            }
            .onEnded { _ in
                if overTrash {
                    Haptic.impact(.light)
                    withNeonAnimation(NeonMotion.quick) { model.overlays.removeAll { $0.id == overlay.id } }
                    if active == overlay.id { active = nil }
                }
                dragging = nil
                dragStart = nil
                overTrash = false
            }
    }

    private var pinchGesture: some Gesture {
        MagnificationGesture()
            .simultaneously(with: RotationGesture())
            .onChanged { value in
                guard model.tool == nil, textDraft == nil,
                      let id = active ?? model.overlays.last?.id,
                      let index = model.overlays.firstIndex(where: { $0.id == id }) else { return }
                if pinchStart == nil {
                    pinchStart = (model.overlays[index].scale, model.overlays[index].rotation)
                    active = id
                }
                guard let start = pinchStart else { return }
                model.overlays[index].scale = min(10, max(0.25, start.scale * (value.first ?? 1)))
                model.overlays[index].rotation = start.rotation + (value.second ?? .zero)
            }
            .onEnded { _ in pinchStart = nil }
    }

    private func drawGesture(in size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                let point = CGPoint(x: value.location.x / max(size.width, 1), y: value.location.y / max(size.height, 1))
                if liveStroke == nil {
                    liveStroke = ChatEditStroke(points: [point], color: model.penColor, width: model.penWidth)
                } else if let last = liveStroke?.points.last,
                          hypot((point.x - last.x) * size.width, (point.y - last.y) * size.height) > 1.5 {
                    liveStroke?.points.append(point)
                }
            }
            .onEnded { _ in
                if let stroke = liveStroke { model.strokes.append(stroke) }
                liveStroke = nil
            }
    }

    // MARK: The chrome

    private var chrome: some View {
        VStack(spacing: 0) {
            if model.tool == .draw {
                drawTopBar
            } else {
                topBar
            }
            Spacer(minLength: 0)
            if dragging != nil {
                trash
                    .padding(.bottom, 24)
                    .transition(.neonPop)
            } else if model.tool == .draw {
                ChatEditPaletteRow(color: $model.penColor, width: $model.penWidth)
                    .padding(.bottom, 8)
                    .transition(.neonRise)
            } else if let forStory {
                ChatCameraNextBar {
                    forStory(model.flattened())
                }
                .padding(.bottom, 4)
            } else {
                ChatCameraCaptionBar(
                    caption: $caption,
                    chatName: chatName,
                    isSending: sending,
                    focused: $captionFocused,
                    onRetake: onRetake,
                    onSend: send
                )
                .padding(.bottom, 4)
            }
        }
        .padding(.top, 6)
        .padding(.bottom, 4)
    }

    private var topBar: some View {
        HStack(spacing: 8) {
            ChatCameraButton("xmark", label: L("Close")) { onClose() }
            Spacer(minLength: 4)
            ChatCameraButton(saving ? "ellipsis" : "arrow.down.to.line", label: L("Save to Photos")) { save() }
                .disabled(saving)
            if forStory == nil {
                ChatCameraWordButton(word: "HD", label: L("HD"), isOn: model.hd) {
                    model.hd.toggle()
                    if model.hd {
                        Toast.info(L("HD"), detail: L("Sent at the size it was taken, not shrunk for the chat."))
                    }
                }
                .accessibilityValue(model.hd ? L("On") : L("Off"))
            }
            ChatCameraButton("crop.rotate", label: L("Crop and rotate")) {
                captionFocused = false
                model.tool = .crop
            }
            ChatCameraButton("face.smiling", label: L("Stickers")) {
                captionFocused = false
                showStickers = true
            }
            ChatCameraWordButton(word: "Aa", label: L("Text")) { beginText(editing: nil) }
            ChatCameraButton("pencil", label: L("Draw")) {
                captionFocused = false
                model.tool = .draw
            }
        }
        .padding(.horizontal, 12)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    private var drawTopBar: some View {
        HStack(spacing: 8) {
            ChatCameraButton("arrow.uturn.backward", label: L("Undo")) {
                if !model.strokes.isEmpty { model.strokes.removeLast() }
            }
            .disabled(model.strokes.isEmpty)
            .opacity(model.strokes.isEmpty ? 0.45 : 1)
            Spacer(minLength: 4)
            // "Done" is a task's state in the app's Arabic, so the finish
            // button is a tick, as the photo editors on the phone draw it.
            ChatCameraButton("checkmark", label: L("Finish editing"), isOn: true) {
                model.tool = nil
            }
        }
        .padding(.horizontal, 12)
    }

    private var trash: some View {
        Image(systemName: overTrash ? "trash.fill" : "trash")
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 62, height: 62)
            .background(Circle().fill(overTrash ? Color.neonDanger : Color.black.opacity(0.5)))
            .overlay(Circle().strokeBorder(Color.white.opacity(0.3), lineWidth: 1))
            .scaleEffect(overTrash ? 1.15 : 1)
            .animation(NeonMotion.resolved(NeonMotion.snappy), value: overTrash)
            .background(
                GeometryReader { geo in
                    Color.clear
                        .onAppear { trashFrame = geo.frame(in: .global) }
                        .onChange(of: geo.frame(in: .global)) { trashFrame = $0 }
                }
            )
            .accessibilityLabel(L("Drop here to remove"))
    }

    // MARK: Text

    private func beginText(editing overlay: ChatEditOverlay?) {
        captionFocused = false
        if let overlay, case .text(let text) = overlay.kind {
            textDraft = ChatEditTextDraft(id: overlay.id, text: text, color: overlay.color, boxed: overlay.boxed, isNew: false)
        } else {
            textDraft = ChatEditTextDraft(id: UUID(), text: "", color: 0, boxed: false, isNew: true)
        }
    }

    private func commitText(_ draft: ChatEditTextDraft) {
        let text = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
        if draft.isNew {
            if !text.isEmpty {
                let overlay = ChatEditOverlay(kind: .text(text), color: draft.color, boxed: draft.boxed)
                model.overlays.append(overlay)
                active = overlay.id
            }
        } else if let index = model.overlays.firstIndex(where: { $0.id == draft.id }) {
            if text.isEmpty {
                model.overlays.remove(at: index)
            } else {
                model.overlays[index].kind = .text(text)
                model.overlays[index].color = draft.color
                model.overlays[index].boxed = draft.boxed
                active = draft.id
            }
        }
        textDraft = nil
    }

    // MARK: Saving and sending

    private func save() {
        guard !saving else { return }
        saving = true
        let picture = model.flattened()
        Task {
            await ChatCameraUpload.save(image: picture)
            saving = false
        }
    }

    private func send() {
        guard !sending else { return }
        sending = true
        captionFocused = false
        let picture = model.flattened()
        let hd = model.hd
        Task {
            let file = await Task.detached(priority: .userInitiated) { ChatCameraUpload.photo(picture, hd: hd) }.value
            sending = false
            guard let file else {
                Haptic.error()
                Toast.error(L("That photo could not be prepared."))
                return
            }
            onSend(file)
        }
    }
}
