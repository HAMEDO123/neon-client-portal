import SwiftUI

// Fullscreen viewer: swipe between images, pinch to zoom, double-tap to
// toggle zoom, drag to pan while zoomed.
struct ImageViewerItem: Identifiable {
    let id: String
    let url: URL?
    let caption: String?
}

struct ImageViewerPayload: Identifiable {
    let id = UUID()
    let items: [ImageViewerItem]
    let startIndex: Int
}

struct ImageViewerView: View {
    let payload: ImageViewerPayload

    @Environment(\.dismiss) private var dismiss
    @State private var index: Int

    init(payload: ImageViewerPayload) {
        self.payload = payload
        _index = State(initialValue: payload.startIndex)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            TabView(selection: $index) {
                ForEach(Array(payload.items.enumerated()), id: \.element.id) { i, item in
                    ZoomableImageView(url: item.url)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: payload.items.count > 1 ? .automatic : .never))

            VStack {
                HStack {
                    if payload.items.count > 1 {
                        Text("\(index + 1) / \(payload.items.count)")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.8))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.white.opacity(0.15), in: Capsule())
                    }
                    Spacer()
                    Button {
                        Haptic.tap()
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(.white.opacity(0.15), in: Circle())
                    }
                    .buttonStyle(.pressable)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                Spacer()

                if let caption = payload.items[safe: index]?.caption, !caption.isEmpty {
                    Text(caption)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.85))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                        .padding(.bottom, 30)
                        .transition(.opacity)
                }
            }
        }
        .animation(.easeOut(duration: 0.2), value: index)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private struct ZoomableImageView: View {
    let url: URL?

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geo in
            Group {
                if let url {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                        case .failure:
                            Image(systemName: "exclamationmark.triangle")
                                .font(.system(size: 28))
                                .foregroundStyle(.white.opacity(0.5))
                        default:
                            ProgressView().tint(.white)
                        }
                    }
                } else {
                    Image(systemName: "photo")
                        .font(.system(size: 28))
                        .foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .scaleEffect(scale)
            .offset(offset)
            .gesture(magnification.simultaneously(with: scale > 1 ? panning : nil))
            .onTapGesture(count: 2) {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                    if scale > 1 {
                        reset()
                    } else {
                        scale = 2.5
                        lastScale = 2.5
                    }
                }
            }
        }
    }

    private var magnification: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                scale = max(1, min(5, lastScale * value))
            }
            .onEnded { _ in
                lastScale = scale
                if scale <= 1.02 {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { reset() }
                }
            }
    }

    private var panning: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                lastOffset = offset
            }
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
    }
}
