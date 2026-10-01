#if DEBUG
import SwiftUI

/// Opens one screen straight from launch, for screenshots — Debug builds only.
///
///     SIMCTL_CHILD_NEON_DEBUG_TOKEN=<token> \
///       xcrun simctl launch <device> com.neonjo.staff -neonScreen <id>
///     xcrun simctl io <device> screenshot shot.png
///
/// `-neonScreen list` prints every id to the console. Each screen is the real
/// one, reading live data; nothing here taps, sends or changes anything.
///
/// Each area lists its own screens in its own file,
/// `Features/<Area>/<Area>Screens.swift`, so adding one never means two
/// people editing the same switch.
enum DebugScreens {
    /// `-neonScroll <anchor>`: once loaded, scroll to the view with that
    /// `.id(...)`, to screenshot what is below the first screenful.
    static var scrollAnchor: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-neonScroll"), args.indices.contains(index + 1) else { return nil }
        return args[index + 1]
    }

    static var requested: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-neonScreen"), args.indices.contains(index + 1) else { return nil }
        return args[index + 1]
    }

    /// The tabs, with the real tab bar under them.
    static let tabs: [String: AdminTab] = [
        "tab-home": .home, "tab-projects": .projects, "tab-tasks": .tasks, "tab-chat": .chat, "tab-more": .more,
    ]

    static let appIds = ["login", "kit", "office-shopping"] + (2...DesignKitGallery.slices).map { "kit-\($0)" }

    @MainActor static func view(_ id: String) -> AnyView? {
        switch id {
        case "login": return AnyView(LoginView())
        case "office-shopping": return debugPushed(OfficeShoppingView())
        case "kit": return AnyView(DesignKitGallery())
        case let kit where kit.hasPrefix("kit-"):
            if let slice = Int(kit.dropFirst(4)), (2...DesignKitGallery.slices).contains(slice) {
                return AnyView(DesignKitGallery(slice: slice))
            }
        default: break
        }
        for area in areas {
            if let view = area(id) { return view }
        }
        return nil
    }

    @MainActor private static var areas: [(String) -> AnyView?] {
        [
            HomeScreens.view, HomeInsightsScreens.view, ProjectsScreens.view, ProjectFilesScreens.view,
            TasksScreens.view, TeamScreens.view, OpsScreens.view, WhatsAppScreens.view, ChatScreens.view,
            ChatRoomScreens.view, MeScreens.view, CallsScreens.view, CameraScreens.view, CamerasScreens.view,
        ]
    }

    static var allIds: [String] {
        tabs.keys.sorted() + appIds + HomeScreens.ids + HomeInsightsScreens.ids + ProjectsScreens.ids
            + ProjectFilesScreens.ids + TasksScreens.ids + TeamScreens.ids + OpsScreens.ids + WhatsAppScreens.ids
            + ChatScreens.ids + ChatRoomScreens.ids + MeScreens.ids + CallsScreens.ids + CameraScreens.ids
            + CamerasScreens.ids
    }
}

/// What the app shows instead of its tabs when `-neonScreen` is given.
struct DebugScreenHost: View {
    let id: String

    var body: some View {
        if let tab = DebugScreens.tabs[id] {
            AdminHome(initialTab: tab)
        } else if let view = DebugScreens.view(id) {
            view
        } else {
            VStack(spacing: 8) {
                Text(verbatim: "No screen called \"\(id)\".").font(.headline)
                Text(verbatim: "Launch with -neonScreen list to print them.").font(.footnote)
            }
            .onAppear { print("NEON SCREENS:", DebugScreens.allIds.joined(separator: " ")) }
        }
    }
}

extension View {
    /// Honours `-neonScroll <anchor>` for screenshots: put it on the content
    /// inside a ScrollViewReader, and `.id("anchor")` on the sections.
    func debugScroll(_ proxy: ScrollViewProxy) -> some View {
        task {
            guard let anchor = DebugScreens.scrollAnchor else { return }
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            proxy.scrollTo(anchor, anchor: .top)
        }
    }
}

/// A pushed screen, inside the navigation stack it is normally pushed onto.
@MainActor func debugPushed<V: View>(_ view: V) -> AnyView {
    AnyView(NavigationStack { view })
}

/// A screen that needs something from the server first — the first project,
/// the first employee — to be opened with.
struct DebugAsync<Value, Content: View>: View {
    let load: @MainActor () async throws -> Value?
    @ViewBuilder let content: (Value) -> Content

    @State private var value: Value?
    @State private var failure: String?

    var body: some View {
        Group {
            if let value {
                content(value)
            } else if let failure {
                Text(verbatim: failure).font(.footnote).padding()
            } else {
                ProgressView()
            }
        }
        .task {
            do {
                if let loaded = try await load() { value = loaded } else { failure = "Nothing on the server to open this with." }
            } catch {
                failure = "\(error)"
            }
        }
    }
}
#endif
