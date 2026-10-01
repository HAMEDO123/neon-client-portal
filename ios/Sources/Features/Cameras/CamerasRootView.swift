import SwiftUI
import UIKit

/// The studio's cameras: every one as a live-looking tile, refreshed about
/// every two seconds while the screen is in front and the app is active.
/// Tap one to watch it live; hold one to change it, try it or remove it; the
/// round + adds a camera. The manager's alone (the server refuses anybody
/// else). Pushed from More, so no `NavigationStack` of its own.
struct CamerasRootView: View {
    private let source: CameraFeedSource

    @StateObject private var wall = CameraWall()
    @Environment(\.scenePhase) private var scenePhase

    @State private var list: CameraList?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var refreshTick = 0
    @State private var watching: CameraItem?
    @State private var form: CameraFormTarget?
    @State private var removing: CameraItem?

    /// The studio's cameras, from the server.
    init() {
        self.init(source: NetworkCameraSource.shared)
    }

    /// The same screen over another source — Debug screenshots draw their own.
    init(source: CameraFeedSource) {
        self.source = source
    }

    /// Tiles ask for pictures only while somebody can see them.
    private var polling: Bool { scenePhase == .active && watching == nil && form == nil }

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack) {
            LoadStateView(value: list, error: errorMessage, cachedAt: cachedAt, retry: load) {
                CameraGridPlaceholder()
            } content: { list in
                content(list)
            }
        }
        .refreshable {
            await load()
            refreshTick += 1
        }
        .navigationTitle(L("Cameras"))
        // An empty list has its own button in the middle of the page.
        .floatingActionButton("plus", label: L("Add camera"), isVisible: list?.cameras.isEmpty == false && cachedAt == nil) {
            form = .add
        }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .neonDataChanged)) { note in
            if let name = note.object as? String, name.hasPrefix("cameras/") {
                Task { await load() }
            }
        }
        .sheet(item: $form) { target in
            CameraFormSheet(target: target, source: source) { _ in
                Task { await load() }
            }
        }
        .fullScreenCover(item: $watching) { camera in
            CameraLiveView(cameras: list?.cameras ?? [camera], startAt: camera.id, source: source, wall: wall)
                .neonLanguage()
        }
        .confirmDestructive(
            item: $removing,
            title: { L("Remove %@?", $0.name) },
            message: { _ in L("Nothing changes on the camera itself; it just leaves the app.") },
            actionTitle: L("Remove")
        ) { camera in
            Task { await remove(camera) }
        }
    }

    @ViewBuilder
    private func content(_ list: CameraList) -> some View {
        if list.cameras.isEmpty {
            EmptyState(
                symbol: list.relayDown ? "video.slash.fill" : "video.fill",
                title: list.relayDown ? L("The cameras are offline") : L("No cameras yet"),
                detail: emptyDetail(list),
                actionTitle: cachedAt == nil ? L("Add camera") : nil,
                action: { form = .add },
                hue: .indigo,
                card: true
            )
        } else {
            if list.relayDown {
                StatusNote(
                    symbol: "exclamationmark.triangle.fill",
                    tone: .warning,
                    title: L("The camera relay on the office PC isn't running."),
                    detail: L("The pictures come back as soon as it is started again.")
                )
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 158), spacing: NeonSpace.md)], spacing: NeonSpace.md) {
                ForEach(list.cameras) { camera in
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
                    }
                    .buttonStyle(.pressableCard)
                    .neonContextShape(radius: NeonRadius.lg)
                    .contextMenu { menu(for: camera) }
                    .task(id: "\(polling)-\(refreshTick)") {
                        guard polling else { return }
                        await wall.poll(camera.id, source: source)
                    }
                }
            }
            .id("grid")
        }
    }

    /// Why there is nothing, when that is worth saying (the relay is down,
    /// the saved list cannot be read); otherwise an invitation.
    private func emptyDetail(_ list: CameraList) -> String {
        if let why = list.why, why != "The cameras aren't connected yet." { return L(why) }
        return L("Add the studio's Tapo cameras to watch them live from anywhere.")
    }

    @ViewBuilder
    private func menu(for camera: CameraItem) -> some View {
        Button {
            watching = camera
        } label: {
            Label(L("Watch live"), systemImage: "play.rectangle.fill")
        }
        if camera.canEdit && cachedAt == nil {
            Button {
                form = .edit(camera)
            } label: {
                Label(L("Edit"), systemImage: "pencil")
            }
            Button {
                Task { await test(camera) }
            } label: {
                Label(L("Test connection"), systemImage: "antenna.radiowaves.left.and.right")
            }
            Button(role: .destructive) {
                removing = camera
            } label: {
                Label(L("Remove"), systemImage: "trash")
            }
        } else if !camera.canEdit {
            Text(L("Added on the office PC"))
        }
    }

    private func load() async {
        do {
            let loaded = try await source.list()
            withNeonAnimation(.smooth) {
                list = loaded.value
            }
            cachedAt = loaded.cachedAt
            errorMessage = nil
            wall.keep(Set(loaded.value.cameras.map(\.id)))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func test(_ camera: CameraItem) async {
        Toast.info(L("Trying %@…", camera.name))
        do {
            let result = try await source.test(id: camera.id)
            if result.ok {
                Haptic.success()
                Toast.success(L("%@ is connected", camera.name), detail: L(result.message))
            } else {
                Haptic.warning()
                Toast.warning(L("No picture from %@", camera.name), detail: L(result.message))
            }
            refreshTick += 1
        } catch {
            Toast.error(error)
        }
    }

    private func remove(_ camera: CameraItem) async {
        do {
            try await source.delete(id: camera.id)
            Haptic.success()
            Toast.success(L("%@ removed", camera.name))
            await load()
        } catch {
            Toast.error(error)
        }
    }
}

// MARK: - The pictures behind the tiles

/// Every camera's latest snapshot, kept while the screen is open so a tile
/// scrolled back into view — and the live view while it connects — has a
/// picture at once.
@MainActor
final class CameraWall: ObservableObject {
    @Published private(set) var images: [String: UIImage] = [:]
    @Published private(set) var failures: [String: Int] = [:]
    @Published private(set) var receivedAt: [String: Date] = [:]

    /// A picture this recent counts as live.
    func isFresh(_ id: String) -> Bool {
        guard let at = receivedAt[id] else { return false }
        return Date().timeIntervalSince(at) < 8
    }

    /// Fetches this camera's picture again and again — one request at a
    /// time, about every two seconds, less often while it fails — until the
    /// calling task is cancelled.
    func poll(_ id: String, source: CameraFeedSource) async {
        while !Task.isCancelled {
            let started = Date()
            do {
                let image = try await source.snapshot(id: id, width: 640)
                if Task.isCancelled { return }
                images[id] = image
                failures[id] = 0
                receivedAt[id] = Date()
            } catch is CancellationError {
                return
            } catch {
                if Task.isCancelled { return }
                failures[id, default: 0] += 1
                // Signed out, not the manager's, or gone: asking again changes nothing.
                if let status = (error as? CameraFeedError)?.status, [401, 403, 404].contains(status) { return }
            }
            let failing = failures[id] ?? 0
            let every: Double = failing == 0 ? 2 : (failing < 3 ? 4 : 10)
            let wait = max(0.25, every - Date().timeIntervalSince(started))
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
        }
    }

    /// Forgets cameras that have left the list.
    func keep(_ ids: Set<String>) {
        images = images.filter { ids.contains($0.key) }
        failures = failures.filter { ids.contains($0.key) }
        receivedAt = receivedAt.filter { ids.contains($0.key) }
    }
}

// MARK: - A tile

private struct CameraTile: View {
    let camera: CameraItem
    let image: UIImage?
    let failures: Int
    let fresh: Bool

    /// One failed picture after a good one is a blip; two in a row, or none
    /// ever, and the tile says so.
    private var noPicture: Bool { failures >= 2 || (image == nil && failures >= 1) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            picture
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: NeonRadius.md - 2, style: .continuous))
                // The picture's top right, in either language: a picture is
                // never mirrored, and a Tapo burns its clock into the top left.
                .overlay(alignment: .top) {
                    if fresh && !noPicture {
                        HStack {
                            Spacer(minLength: 0)
                            CameraLiveBadge()
                                .environment(\.layoutDirection, AppLanguage.current.layoutDirection)
                        }
                        .padding(6)
                        .environment(\.layoutDirection, .leftToRight)
                        .transition(.opacity)
                    }
                }
            HStack(spacing: 6) {
                DirText(camera.name, font: .neonRowTitle, lineLimit: 1)
                if camera.online == false {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.neonWarningStrong)
                        .accessibilityLabel(Text(L("Not reachable")))
                }
            }
            .padding(.horizontal, 2)
        }
        .padding(8)
        .neonSurface(.glass, radius: NeonRadius.lg)
        .animation(NeonMotion.gentle, value: noPicture)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(camera.name))
        .accessibilityHint(Text(noPicture ? L("No picture") : L("Watch live")))
    }

    @ViewBuilder
    private var picture: some View {
        ZStack {
            Color.neonInk.opacity(0.92)
            if let image, !noPicture {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .transition(.opacity)
            } else if noPicture {
                VStack(spacing: 6) {
                    Image(systemName: "video.slash.fill")
                        .font(.system(size: 20, weight: .semibold))
                    Text(L("No picture"))
                        .font(.neonCaption.weight(.semibold))
                }
                .foregroundStyle(.white.opacity(0.75))
            } else {
                Color.white.opacity(0.08).shimmer()
            }
        }
        .frame(maxWidth: .infinity)
        .clipped()
    }
}

/// "● LIVE" over a picture.
struct CameraLiveBadge: View {
    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Color.neonDanger)
                .frame(width: 6, height: 6)
                .neonPulse(true)
            Text(L("Live"))
                .font(.system(size: 10, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(Capsule().fill(Color.black.opacity(0.45)))
    }
}

/// The grid while the list loads: card-shaped tiles, shimmering.
private struct CameraGridPlaceholder: View {
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 158), spacing: NeonSpace.md)], spacing: NeonSpace.md) {
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    RoundedRectangle(cornerRadius: NeonRadius.md - 2, style: .continuous)
                        .fill(Color.neonInk.opacity(0.07))
                        .aspectRatio(16 / 9, contentMode: .fit)
                    SkeletonBlock(width: 90, height: 12)
                        .padding(.horizontal, 2)
                }
                .padding(8)
                .neonSurface(.glass, radius: NeonRadius.lg)
                .shimmer()
            }
        }
        .accessibilityLabel(Text(L("Loading cameras")))
    }
}
