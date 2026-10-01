import SwiftUI

/// The studio's camera list for Home, loaded with the rest of Home (its pull
/// to refresh included) and again whenever a camera is saved or removed.
/// Kept apart from the card so that Home draws the card only when there is a
/// camera to show — a card that loads itself has to be on screen to do it.
@MainActor
final class HomeCamerasModel: ObservableObject {
    @Published private(set) var cameras: [CameraItem] = []
    @Published private(set) var relayDown = false
    let source: CameraFeedSource
    private var changes: NSObjectProtocol?

    init(source: CameraFeedSource = NetworkCameraSource.shared) {
        self.source = source
        changes = NotificationCenter.default.addObserver(forName: .neonDataChanged, object: nil, queue: .main) { [weak self] note in
            guard let name = note.object as? String, name.hasPrefix("cameras/") else { return }
            Task { @MainActor in await self?.load() }
        }
    }

    deinit {
        if let changes { NotificationCenter.default.removeObserver(changes) }
    }

    /// No answer leaves what was there: Home is not the place to say the
    /// relay is down — the Cameras screen and Network & server are.
    func load() async {
        guard let loaded = try? await source.list() else { return }
        withNeonAnimation(NeonMotion.gentle) {
            cameras = loaded.value.cameras
            relayDown = loaded.value.relayDown
        }
    }
}

/// The studio's cameras on the manager's Home, right under the hero: a strip
/// of live tiles — the same tiles as the Cameras screen — that open the live
/// view on a tap. Smaller and slower than the Cameras screen's (320 px, every
/// three seconds), because Home is open far more and often on mobile data;
/// and only while Home is actually in front.
struct HomeCamerasCard: View {
    @ObservedObject var model: HomeCamerasModel
    let onViewAll: () -> Void

    @StateObject private var wall = CameraWall()
    @Environment(\.scenePhase) private var scenePhase
    @State private var watching: CameraItem?
    @State private var visible = false

    private var polling: Bool { visible && scenePhase == .active && watching == nil }

    var body: some View {
        SectionCard(
            L("Cameras"),
            subtitle: model.relayDown ? L("The camera relay on the office PC isn't running.") : L("Live from the studio"),
            symbol: "video.fill",
            hue: .red,
            action: onViewAll
        ) {
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: NeonSpace.md) {
                    ForEach(model.cameras) { camera in
                        Button {
                            Haptic.tap()
                            watching = camera
                        } label: {
                            CameraTile(
                                camera: camera,
                                image: wall.images[camera.id],
                                failures: wall.failures[camera.id] ?? 0,
                                fresh: wall.isFresh(camera.id)
                            )
                            .frame(width: model.cameras.count == 1 ? nil : 236)
                        }
                        .buttonStyle(.pressableCard)
                        .task(id: polling) {
                            guard polling else { return }
                            await wall.poll(camera.id, source: model.source, width: 320, every: 3)
                        }
                    }
                }
                .padding(.vertical, 2)
            }
            // A lone camera takes the card's full width.
            .scrollDisabled(model.cameras.count == 1)
        }
        .onAppear { visible = true }
        .onDisappear { visible = false }
        .onChange(of: model.cameras.map(\.id)) { ids in wall.keep(Set(ids)) }
        .fullScreenCover(item: $watching) { camera in
            CameraLiveView(cameras: model.cameras, startAt: camera.id, source: model.source, wall: wall)
                .neonLanguage()
        }
    }
}
