import SwiftUI

/// Adding a camera, or changing one.
enum CameraFormTarget: Identifiable {
    case add
    case edit(CameraItem)

    var id: String {
        switch self {
        case .add: return "add"
        case .edit(let camera): return camera.id
        }
    }
}

/// The add/edit sheet: a name, the camera's IP address, and how it signs in.
/// Saving keeps the camera whatever happens next — a camera that is off today
/// is still the studio's — and the server tries it at once; the answer is
/// shown here in plain words. A saved password is never sent back: editing
/// with the password box empty keeps it.
struct CameraFormSheet: View {
    let target: CameraFormTarget
    let source: CameraFeedSource
    var onSaved: (CameraItem) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var ip: String
    @State private var username: String
    @State private var password = ""
    @State private var result: CameraTestResult?
    @State private var saved: CameraItem?
    @State private var refusal: String?
    @State private var attempts = 0

    init(
        target: CameraFormTarget,
        source: CameraFeedSource,
        result: CameraTestResult? = nil,
        onSaved: @escaping (CameraItem) -> Void = { _ in }
    ) {
        self.target = target
        self.source = source
        self.onSaved = onSaved
        if case .edit(let camera) = target {
            _name = State(initialValue: camera.name)
            _ip = State(initialValue: camera.ip ?? "")
            _username = State(initialValue: camera.username ?? "")
            _saved = State(initialValue: result == nil ? nil : camera)
        } else {
            _name = State(initialValue: "")
            _ip = State(initialValue: "")
            _username = State(initialValue: "")
        }
        _result = State(initialValue: result)
    }

    private var editing: CameraItem? {
        if case .edit(let camera) = target { return camera }
        return nil
    }

    private var trimmedIP: String { ip.trimmingCharacters(in: .whitespaces) }

    /// Four numbers 0–255 with dots — the same rule the server applies, so a
    /// mistyped address is caught before anything is sent.
    private var ipLooksRight: Bool {
        let parts = trimmedIP.split(separator: ".", omittingEmptySubsequences: false)
        return parts.count == 4 && parts.allSatisfy { part in
            guard (1...3).contains(part.count), part.allSatisfy(\.isASCII), let value = Int(part) else { return false }
            return value <= 255 && !(part.count > 1 && part.first == "0")
        }
    }

    private var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty
            && ipLooksRight
            && !username.trimmingCharacters(in: .whitespaces).isEmpty
            && (editing != nil || !password.isEmpty)
    }

    private var usesTapoLogin: Bool { username.contains("@") }

    var body: some View {
        SheetScaffold(
            editing == nil ? L("Add camera") : L("Edit camera"),
            subtitle: editing == nil ? L("A Tapo camera on the office network") : editing?.name,
            symbol: editing == nil ? "video.badge.plus" : "video.fill",
            primaryTitle: result?.ok == true ? L("Close") : (saved == nil ? L("Save and test") : L("Save and test again")),
            isPrimaryEnabled: result?.ok == true || isValid
        ) {
            await primary()
        } content: {
            if let result {
                CameraTestNote(result: result, saved: true)
                    .transition(.neonRise)
            } else if let refusal {
                StatusNote(symbol: "exclamationmark.octagon.fill", tone: .danger, title: L("Not saved"), detail: refusal)
                    .transition(.neonRise)
            }

            FormSection(L("Camera")) {
                NeonTextField(
                    L("Name"),
                    text: $name,
                    prompt: L("Front door"),
                    symbol: "tag.fill",
                    isRequired: true,
                    capitalization: .words
                )
                NeonTextField(
                    L("IP address"),
                    text: $ip,
                    prompt: "192.168.1.20",
                    symbol: "network",
                    isRequired: true,
                    hint: L("Tapo app → the camera → ⚙︎ → Device Info → IP address."),
                    error: !trimmedIP.isEmpty && !ipLooksRight ? L("Four numbers with dots, like 192.168.1.20.") : nil,
                    keyboard: .numbersAndPunctuation,
                    capitalization: .never,
                    autocorrect: false,
                    leftToRight: true
                )
            }

            FormSection(L("How it signs in")) {
                NeonTextField(
                    L("Username or email"),
                    text: $username,
                    prompt: L("The Camera Account's username"),
                    symbol: "person.fill",
                    isRequired: true,
                    keyboard: .emailAddress,
                    capitalization: .never,
                    autocorrect: false,
                    leftToRight: true
                )
                NeonTextField(
                    L("Password"),
                    text: $password,
                    prompt: editing?.hasPassword == true ? L("Leave empty to keep the saved one") : nil,
                    symbol: "key.fill",
                    isRequired: editing == nil,
                    capitalization: .never,
                    autocorrect: false,
                    isSecure: true,
                    leftToRight: true
                )
            }

            CameraAccountExplainer(usesTapoLogin: usesTapoLogin)

            Label(L("Give the camera a fixed address in the router (a DHCP reservation), so it keeps this one."), systemImage: "pin.fill")
                .font(.neonFootnote)
                .foregroundStyle(Color.neonTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .shake(attempts)
        .animation(NeonMotion.smooth, value: result)
        .neonSheet([.large])
    }

    private func primary() async {
        if result?.ok == true {
            dismiss()
            return
        }
        refusal = nil
        do {
            let answer = try await source.save(
                id: saved?.id ?? editing?.id,
                name: name.trimmingCharacters(in: .whitespaces),
                ip: trimmedIP,
                username: username.trimmingCharacters(in: .whitespaces),
                password: password
            )
            saved = answer.camera
            // From now on this is the saved camera: an empty password keeps it.
            password = ""
            withNeonAnimation(.smooth) { result = answer.test }
            onSaved(answer.camera)
            if answer.test.ok {
                Haptic.success()
            } else {
                Haptic.warning()
            }
        } catch {
            Haptic.error()
            attempts += 1
            withNeonAnimation(.smooth) { refusal = error.localizedDescription }
        }
    }
}

/// What a test said, as a note: green when the picture came through, orange
/// with the reason when it did not.
struct CameraTestNote: View {
    let result: CameraTestResult
    var saved = false

    var body: some View {
        if result.ok {
            StatusNote(
                symbol: "checkmark.circle.fill",
                tone: .success,
                title: saved ? L("Saved — and it's working") : L("It's working"),
                detail: L(result.message)
            )
        } else {
            StatusNote(
                symbol: "exclamationmark.triangle.fill",
                tone: .warning,
                title: saved ? L("Saved, but no picture yet") : L("No picture yet"),
                detail: L(result.message)
            )
        }
    }
}

/// The Camera Account, explained where the username is typed — the one thing
/// that most often goes wrong.
private struct CameraAccountExplainer: View {
    let usesTapoLogin: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            StatusNote(
                symbol: "info.circle.fill",
                tone: .info,
                title: L("Use the camera's Camera Account"),
                detail: L("In the Tapo app: the camera → ⚙︎ → Advanced Settings → Camera Account. Make any username and password there, and type them here. It is not your Tapo login.")
            )
            if usesTapoLogin {
                StatusNote(
                    symbol: "exclamationmark.bubble.fill",
                    tone: .warning,
                    title: L("That looks like the Tapo login"),
                    detail: L("With the Tapo email and password the picture can still come through, but the camera can't be moved from the app. A Camera Account does both.")
                )
                .transition(.neonRise)
            }
        }
        .animation(NeonMotion.smooth, value: usesTapoLogin)
    }
}
