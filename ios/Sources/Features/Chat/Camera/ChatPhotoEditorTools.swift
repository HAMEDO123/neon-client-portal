import SwiftUI

// The editor's tools: writing text on the photo, the pencil's colours, the
// sticker sheet, and cropping and turning.

// MARK: - Text

/// Text being written or changed, before it goes on the photo.
struct ChatEditTextDraft: Identifiable, Equatable {
    let id: UUID
    var text: String
    var color: Int
    var boxed: Bool
    /// Written now, rather than an overlay already on the photo.
    let isNew: Bool
}

/// The photo dimmed, the words being written large in the middle in their
/// colour, the palette above the keyboard. Done (or a tap outside) puts them
/// on the photo; emptied, they come off.
struct ChatEditTextEntry: View {
    @Binding var draft: ChatEditTextDraft?
    let onDone: (ChatEditTextDraft) -> Void

    @FocusState private var focused: Bool

    var body: some View {
        if let current = draft {
            ZStack {
                Color.black.opacity(0.55)
                    .ignoresSafeArea()
                    .onTapGesture(perform: finish)

                VStack(spacing: 0) {
                    HStack(spacing: 8) {
                        ChatCameraWordButton(word: "A", label: L("Text on a box"), isOn: current.boxed) {
                            draft?.boxed.toggle()
                        }
                        .accessibilityValue(current.boxed ? L("On") : L("Off"))
                        Spacer(minLength: 4)
                        Button(action: finish) {
                            Text(L("Done"))
                                .font(.system(.subheadline, weight: .bold))
                                .foregroundStyle(.black)
                                .padding(.horizontal, 18)
                                .frame(height: 36)
                                .background(Capsule().fill(Color.white))
                        }
                        .buttonStyle(PressableStyle(scale: 0.9))
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 6)

                    Spacer(minLength: 12)

                    TextField("", text: textBinding, prompt: Text(L("Type something")).foregroundColor(.white.opacity(0.45)), axis: .vertical)
                        .font(.system(size: 32, weight: .bold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(current.boxed ? ChatEditOverlayLabel.ink(on: current.color) : Color(ChatEditPalette.color(current.color)))
                        .tint(current.boxed ? ChatEditOverlayLabel.ink(on: current.color) : Color(ChatEditPalette.color(current.color)))
                        .lineLimit(1...6)
                        .focused($focused)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background {
                            if current.boxed {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(Color(ChatEditPalette.color(current.color)))
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 28)

                    Spacer(minLength: 12)

                    ChatEditPaletteRow(color: colorBinding, width: nil)
                        .padding(.bottom, 10)
                }
            }
            .onAppear { focused = true }
        }
    }

    private var textBinding: Binding<String> {
        Binding(get: { draft?.text ?? "" }, set: { draft?.text = $0 })
    }

    private var colorBinding: Binding<Int> {
        Binding(get: { draft?.color ?? 0 }, set: { draft?.color = $0 })
    }

    private func finish() {
        focused = false
        guard let draft else { return }
        Haptic.tap()
        onDone(draft)
    }
}

/// The palette: a row of colour dots, and for the pencil three line weights.
struct ChatEditPaletteRow: View {
    @Binding var color: Int
    /// The pencil's weight; nil for text, which has none.
    var width: Binding<CGFloat>?

    static let weights: [CGFloat] = [0.006, 0.012, 0.024]

    init(color: Binding<Int>, width: Binding<CGFloat>?) {
        _color = color
        self.width = width
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                if let width {
                    ForEach(Self.weights, id: \.self) { weight in
                        let chosen = abs(width.wrappedValue - weight) < 0.0001
                        Button {
                            Haptic.selection()
                            width.wrappedValue = weight
                        } label: {
                            Circle()
                                .fill(Color.white)
                                .frame(width: 6 + weight * 600, height: 6 + weight * 600)
                                .frame(width: 34, height: 34)
                                .background(ChatCameraDisc(isOn: false))
                                .overlay(Circle().strokeBorder(chosen ? Color.neonAmber : .clear, lineWidth: 2))
                        }
                        .buttonStyle(PressableStyle(scale: 0.88))
                        .accessibilityLabel(weightLabel(weight))
                        .accessibilityAddTraits(chosen ? .isSelected : [])
                    }
                    Rectangle().fill(Color.white.opacity(0.25)).frame(width: 1, height: 24)
                }
                ForEach(ChatEditPalette.colors.indices, id: \.self) { index in
                    let chosen = color == index
                    Button {
                        Haptic.selection()
                        color = index
                    } label: {
                        Circle()
                            .fill(Color(ChatEditPalette.color(index)))
                            .frame(width: chosen ? 30 : 26, height: chosen ? 30 : 26)
                            .overlay(Circle().strokeBorder(Color.white, lineWidth: chosen ? 3 : 1.5))
                            .shadow(color: .black.opacity(0.3), radius: 2)
                            .frame(width: 34, height: 34)
                    }
                    .buttonStyle(PressableStyle(scale: 0.88))
                    .accessibilityLabel(ChatEditPalette.name(index))
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 5)
        }
        .animation(NeonMotion.resolved(NeonMotion.snappy), value: color)
    }

    private func weightLabel(_ weight: CGFloat) -> String {
        switch weight {
        case Self.weights[0]: return L("Thin")
        case Self.weights[2]: return L("Thick")
        default: return L("Medium")
        }
    }
}

// MARK: - Stickers

/// Emoji to stick on the photo, grouped: tap one and it lands in the middle.
struct ChatStickerSheet: View {
    let onPick: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    private static let groups: [(title: String, emoji: [String])] = [
        ("Work", ["✅", "❌", "⚠️", "❗", "❓", "📌", "📍", "🔴", "🟢", "🟡", "⭐", "💯",
                  "🔥", "👀", "🛠️", "🔧", "🔨", "📐", "📏", "🪚", "🧱", "🪵", "🎨", "🖌️",
                  "💡", "🏠", "🏗️", "🛋️", "🪑", "🛏️", "🚪", "🪟", "🚿", "🛁", "🚽", "🪴"]),
        ("Hands", ["👍", "👎", "👌", "🤝", "👏", "🙏", "💪", "✌️", "🤞", "👆", "👇", "👈",
                   "👉", "☝️", "✋", "🫶"]),
        ("Faces", ["😀", "😂", "🥹", "😍", "🥰", "😎", "🤩", "🤔", "😮", "😅", "😬", "😴",
                   "🥳", "😇", "🤯", "😡", "😢", "🙈", "🤗", "🫡"]),
        ("Hearts", ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💖", "💔", "✨", "🎉",
                    "🎁", "🌹", "☀️", "🌙", "⚡", "☕"]),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(Self.groups, id: \.title) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel(L(group.title))
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 6), spacing: 4) {
                                ForEach(group.emoji, id: \.self) { emoji in
                                    Button {
                                        Haptic.tap()
                                        onPick(emoji)
                                        dismiss()
                                    } label: {
                                        Text(verbatim: emoji)
                                            .font(.system(size: 38))
                                            .frame(maxWidth: .infinity, minHeight: 54)
                                            .contentShape(Rectangle())
                                    }
                                    .buttonStyle(PressableStyle(scale: 0.8))
                                    .accessibilityLabel(Text(verbatim: emoji))
                                }
                            }
                        }
                    }
                }
                .padding(NeonSpace.gutter)
            }
            .navigationTitle(L("Stickers"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Close")) { dismiss() }
                }
            }
        }
        .neonSheet([.medium, .large])
    }
}

// MARK: - Crop and turn

/// Cropping: the photo with a frame to drag by its corners or move whole,
/// the outside dimmed; a turn button, the usual shapes, and Reset.
struct ChatCropView: View {
    let image: UIImage
    let onCancel: () -> Void
    /// The kept part (a fraction of the turned photo) and how many quarter
    /// turns to the left.
    let onDone: (CGRect, Int) -> Void

    enum CropShape: CaseIterable, Identifiable {
        case free, square, fourThree, threeFour, sixteenNine

        var id: Self { self }

        var title: String {
            switch self {
            case .free: return L("Free")
            case .square: return L("Square")
            case .fourThree: return "4:3"
            case .threeFour: return "3:4"
            case .sixteenNine: return "16:9"
            }
        }

        /// Width over height.
        var ratio: CGFloat? {
            switch self {
            case .free: return nil
            case .square: return 1
            case .fourThree: return 4.0 / 3.0
            case .threeFour: return 3.0 / 4.0
            case .sixteenNine: return 16.0 / 9.0
            }
        }
    }

    enum Corner: CaseIterable {
        case topLeft, topRight, bottomLeft, bottomRight
    }

    @State private var turns = 0
    @State private var preview: UIImage?
    @State private var rect = CGRect(x: 0, y: 0, width: 1, height: 1)
    @State private var shape: CropShape = .free
    @State private var dragStart: CGRect?

    private var shown: UIImage { preview ?? image }
    private var aspect: CGFloat { shown.size.height > 0 ? shown.size.width / shown.size.height : 1 }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                ChatCameraButton("xmark", label: L("Cancel")) { onCancel() }
                Spacer()
                Button(L("Reset")) {
                    Haptic.tap()
                    turns = 0
                    preview = nil
                    shape = .free
                    rect = CGRect(x: 0, y: 0, width: 1, height: 1)
                }
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(.white)
                .disabled(turns == 0 && rect == CGRect(x: 0, y: 0, width: 1, height: 1))
                Spacer()
                ChatCameraButton("checkmark", label: L("Done"), isOn: true) { onDone(rect, turns) }
            }
            .padding(.horizontal, 12)
            .padding(.top, 6)

            GeometryReader { geo in
                let area = CGRect(origin: .zero, size: geo.size).insetBy(dx: 24, dy: 20)
                let fitted = ChatPhotoEditor.fit(aspect: aspect, in: area.size).offsetBy(dx: area.minX, dy: area.minY)
                cropper(in: fitted)
            }
            .environment(\.layoutDirection, .leftToRight)

            VStack(spacing: 12) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(CropShape.allCases) { option in
                            Button {
                                Haptic.selection()
                                shape = option
                                rect = largest(option.ratio)
                            } label: {
                                Text(verbatim: option.title)
                                    .font(.system(.footnote, weight: .semibold))
                                    .foregroundStyle(shape == option ? Color.black : Color.white)
                                    .padding(.horizontal, 14)
                                    .frame(height: 32)
                                    .background(Capsule().fill(shape == option ? Color.neonAmber : Color.white.opacity(0.14)))
                            }
                            .buttonStyle(PressableStyle(scale: 0.92))
                        }
                    }
                    .padding(.horizontal, 16)
                }
                ChatCameraButton("rotate.left", label: L("Rotate"), size: 46) { turn() }
            }
            .padding(.bottom, 14)
        }
        .background(Color.black.ignoresSafeArea())
    }

    // MARK: The frame

    private func cropper(in fitted: CGRect) -> some View {
        let box = CGRect(
            x: fitted.minX + rect.minX * fitted.width,
            y: fitted.minY + rect.minY * fitted.height,
            width: rect.width * fitted.width,
            height: rect.height * fitted.height
        )
        return ZStack(alignment: .topLeading) {
            Image(uiImage: shown)
                .resizable()
                .frame(width: fitted.width, height: fitted.height)
                .position(x: fitted.midX, y: fitted.midY)

            // The outside of the frame, dimmed.
            Path { path in
                path.addRect(fitted)
                path.addRect(box)
            }
            .fill(Color.black.opacity(0.6), style: FillStyle(eoFill: true))
            .allowsHitTesting(false)

            // Thirds, and the frame itself.
            Path { path in
                for third in [1.0, 2.0] {
                    let x = box.minX + box.width * third / 3
                    let y = box.minY + box.height * third / 3
                    path.move(to: CGPoint(x: x, y: box.minY))
                    path.addLine(to: CGPoint(x: x, y: box.maxY))
                    path.move(to: CGPoint(x: box.minX, y: y))
                    path.addLine(to: CGPoint(x: box.maxX, y: y))
                }
            }
            .stroke(Color.white.opacity(0.35), lineWidth: 0.5)
            .allowsHitTesting(false)

            Rectangle()
                .strokeBorder(Color.white, lineWidth: 1.5)
                .frame(width: box.width, height: box.height)
                .contentShape(Rectangle())
                .position(x: box.midX, y: box.midY)
                .gesture(moveGesture(in: fitted.size))

            ForEach(Corner.allCases, id: \.self) { corner in
                ChatCropHandle(corner: corner)
                    .position(point(of: corner, in: box))
                    .gesture(cornerGesture(corner, in: fitted.size))
            }
        }
    }

    private func point(of corner: Corner, in box: CGRect) -> CGPoint {
        switch corner {
        case .topLeft: return CGPoint(x: box.minX, y: box.minY)
        case .topRight: return CGPoint(x: box.maxX, y: box.minY)
        case .bottomLeft: return CGPoint(x: box.minX, y: box.maxY)
        case .bottomRight: return CGPoint(x: box.maxX, y: box.maxY)
        }
    }

    private func moveGesture(in size: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                if dragStart == nil { dragStart = rect }
                guard let start = dragStart else { return }
                var moved = start.offsetBy(dx: value.translation.width / size.width, dy: value.translation.height / size.height)
                moved.origin.x = min(max(0, moved.minX), 1 - moved.width)
                moved.origin.y = min(max(0, moved.minY), 1 - moved.height)
                rect = moved
            }
            .onEnded { _ in dragStart = nil }
    }

    private func cornerGesture(_ corner: Corner, in size: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                if dragStart == nil { dragStart = rect }
                guard let start = dragStart else { return }
                rect = dragged(corner, start: start, by: value.translation, in: size)
            }
            .onEnded { _ in dragStart = nil }
    }

    /// The frame with one corner moved, the opposite one held; kept to the
    /// chosen shape, inside the photo, and no smaller than 60 points.
    private func dragged(_ corner: Corner, start: CGRect, by translation: CGSize, in size: CGSize) -> CGRect {
        let movesLeft = corner == .topLeft || corner == .bottomLeft
        let movesUp = corner == .topLeft || corner == .topRight
        let anchor = CGPoint(x: movesLeft ? start.maxX : start.minX, y: movesUp ? start.maxY : start.minY)
        let roomX = movesLeft ? anchor.x : 1 - anchor.x
        let roomY = movesUp ? anchor.y : 1 - anchor.y
        let minW = min(roomX, 60 / max(size.width, 1))
        let minH = min(roomY, 60 / max(size.height, 1))

        let dx = translation.width / max(size.width, 1)
        let dy = translation.height / max(size.height, 1)
        var width = start.width + (movesLeft ? -dx : dx)
        var height = start.height + (movesUp ? -dy : dy)
        width = min(max(width, minW), roomX)
        height = min(max(height, minH), roomY)

        if let ratio = shape.ratio {
            // The shape in the photo's fractions: width over height on screen.
            let fractionRatio = ratio * size.height / max(size.width, 1)
            height = width / fractionRatio
            if height > roomY {
                height = roomY
                width = height * fractionRatio
            }
            if height < minH {
                height = minH
                width = min(roomX, height * fractionRatio)
            }
        }
        let x = movesLeft ? anchor.x - width : anchor.x
        let y = movesUp ? anchor.y - height : anchor.y
        return CGRect(x: x, y: y, width: width, height: height)
    }

    /// The biggest frame of a shape that fits the photo, in its middle.
    private func largest(_ ratio: CGFloat?) -> CGRect {
        guard let ratio else { return CGRect(x: 0, y: 0, width: 1, height: 1) }
        let photo = aspect
        if ratio > photo {
            let height = photo / ratio
            return CGRect(x: 0, y: (1 - height) / 2, width: 1, height: height)
        }
        let width = ratio / photo
        return CGRect(x: (1 - width) / 2, y: 0, width: width, height: 1)
    }

    private func turn() {
        turns = (turns + 1) % 4
        let small = image.chatUpright(maxDimension: 1600)
        var turned = small
        for _ in 0..<turns { turned = turned.chatRotatedLeft() }
        preview = turns == 0 ? nil : turned
        rect = largest(shape.ratio)
    }
}

/// A corner of the crop frame: a thick white L, easy to catch.
private struct ChatCropHandle: View {
    let corner: ChatCropView.Corner

    var body: some View {
        let length: CGFloat = 22
        let flipX: CGFloat = corner == .topRight || corner == .bottomRight ? -1 : 1
        let flipY: CGFloat = corner == .bottomLeft || corner == .bottomRight ? -1 : 1
        Path { path in
            path.move(to: CGPoint(x: 0, y: length))
            path.addLine(to: .zero)
            path.addLine(to: CGPoint(x: length, y: 0))
        }
        .stroke(Color.white, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
        .frame(width: length, height: length)
        .scaleEffect(x: flipX, y: flipY, anchor: .center)
        .offset(x: flipX * length / 2 - flipX * 2, y: flipY * length / 2 - flipY * 2)
        .frame(width: 48, height: 48)
        .contentShape(Rectangle())
    }
}
