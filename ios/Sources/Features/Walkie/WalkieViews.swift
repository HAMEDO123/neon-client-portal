import AVFoundation
import SwiftUI

// MARK: - Turning it on

/// Over every screen of somebody on the team until the walkie-talkie is on —
/// the studio made it required, as it did location. Says plainly what it means
/// before iOS asks anything, and needs doing once: iOS keeps it on. Calls and
/// notifications go on underneath, as under the other covers.
struct WalkieRequiredView: View {
    @ObservedObject var center: WalkieCenter = .shared

    var body: some View {
        ZStack {
            ScrollView {
                VStack(spacing: NeonSpace.stack) {
                    IconTile("antenna.radiowaves.left.and.right", hue: .orange, size: 72)
                        .padding(.top, 48)
                    Text(L("Turn on the walkie-talkie"))
                        .font(.neonTitle2)
                        .multilineTextAlignment(.center)
                    VStack(alignment: .leading, spacing: 10) {
                        point("speaker.wave.2.fill", L("When the manager or somebody on the team talks to you, you hear it straight away — even with the phone locked."))
                        point("clock.fill", L("Only during working hours. Outside them, nothing is sent."))
                        point("mic.fill", L("You can talk too: to the manager, to one person, or to everybody."))
                        point("checkmark.seal.fill", L("The studio asks everybody to have it on. You allow it once, and it stays on."))
                    }
                    .padding(NeonSpace.card)
                    .neonSurface(.glass, radius: NeonRadius.lg)

                    if center.state == .joining {
                        NeonButton(L("Turning it on…"), symbol: "antenna.radiowaves.left.and.right", kind: .brand, isLoading: true) {}
                            .disabled(true)
                    } else {
                        NeonButton(L("Allow and turn it on"), symbol: "antenna.radiowaves.left.and.right", kind: .brand) {
                            Haptic.tap()
                            center.turnOn()
                        }
                    }
                    if let problem = center.problem {
                        Text(problem)
                            .font(.neonFootnote)
                            .foregroundStyle(Color.neonDangerStrong)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(NeonSpace.gutter)
            }
        }
        .neonAmbientBackground(animated: true)
        .neonLanguage()
    }

    private func point(_ symbol: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.neonOrangeStrong)
                .frame(width: 22)
            Text(text)
                .font(.neonSubtitle)
                .foregroundStyle(Color.neonInk)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// On the walkie-talkie screen, for whoever has not turned it on — the manager,
/// whom nothing covers: until it is on, nobody can talk to this phone.
struct WalkieHearCard: View {
    @ObservedObject var center: WalkieCenter = .shared

    var body: some View {
        switch center.state {
        case .off, .joining:
            SectionCard(L("Hear the team"), subtitle: L("Turn it on to hear what the team says to you. Once, and it stays on."), symbol: "ear.fill", hue: .orange) {
                VStack(alignment: .leading, spacing: 8) {
                    NeonButton(L("Turn it on"), symbol: "antenna.radiowaves.left.and.right", kind: .brand, isLoading: center.state == .joining) {
                        Haptic.tap()
                        center.turnOn()
                    }
                    if let problem = center.problem {
                        Text(problem).font(.neonFootnote).foregroundStyle(Color.neonDangerStrong)
                    }
                }
            }
        default:
            // On, but the server could not be told: nobody can reach this
            // phone until it is — said here, never hidden.
            if let problem = center.problem {
                StatusNote(symbol: "exclamationmark.triangle.fill", tone: .warning, title: problem, detail: nil)
            }
        }
    }
}

// MARK: - Talking

struct WalkiePerson: Decodable, Identifiable, Equatable {
    /// An employee's id, or "admin" for the manager.
    let id: String
    let name: String
    let role: String?
    let photoUrl: String?
    var manager: Bool? = nil
    let allowed: Bool

    /// "The manager" is the server's word, said in the app's language.
    var shownName: String { manager == true ? L("The manager") : name }
}

struct WalkiePeopleResponse: Decodable {
    /// Inside today's working window: the walkie-talkie speaks only then.
    let open: Bool?
    let people: [WalkiePerson]
}

struct WalkieSent: Decodable {
    /// Who had a phone Apple took it for, and who has not turned it on.
    let heard: [String]
    let notOn: [String]
    let phones: Int
}

extension APIClient {
    func fetchWalkiePeople() async throws -> Loaded<WalkiePeopleResponse> {
        try await read("walkie/people", as: WalkiePeopleResponse.self)
    }

    /// What one press said: to "all", to "admin", or to one person's id.
    func sendWalkie(to target: String, audio: Data, seconds: Double) async throws -> WalkieSent? {
        let outcome = try await performUpload(
            "walkie/send",
            args: [target],
            fields: ["seconds": String(format: "%.1f", seconds)],
            files: [UploadFile(field: "audio", filename: "walkie.m4a", mimeType: "audio/mp4", data: audio)]
        )
        return try outcome.result(WalkieSent.self)
    }
}

/// Choose somebody — or everybody — hold the button and speak; let go and it
/// plays on their phones. The manager and the team alike, during working hours.
struct WalkieTalkieView: View {
    @EnvironmentObject var api: APIClient
    @StateObject private var recorder = WalkieRecorder()
    @State private var people: [WalkiePerson]?
    @State private var open = true
    @State private var errorMessage: String?
    @State private var chosen = WalkieCenter.target
    @State private var sending = false
    @State private var lastSent: String?
    #if DEBUG
    private var preview: [WalkiePerson]?
    init(preview: [WalkiePerson]? = nil, chosen: String = "all", open: Bool = true) {
        self.preview = preview
        _people = State(initialValue: preview)
        _chosen = State(initialValue: chosen)
        _open = State(initialValue: open)
    }
    #endif

    private var target: (id: String, name: String)? {
        if chosen == "all" { return ("all", L("everybody")) }
        return people?.first { $0.id == chosen && $0.allowed }.map { ($0.id, $0.shownName) }
    }

    var body: some View {
        VStack(spacing: 0) {
            NeonScroll(spacing: NeonSpace.stack, lazy: false) {
                WalkieHearCard()
                if !open {
                    StatusNote(symbol: "clock.fill", tone: .info, title: L("The walkie-talkie works during working hours only."), detail: nil)
                }
                if let people {
                    SectionCard(L("Who to talk to"), subtitle: L("Choose, then hold the button and speak."), symbol: "person.wave.2.fill", hue: .orange) {
                        VStack(spacing: 8) {
                            everybodyRow(count: people.filter(\.allowed).count)
                            ForEach(people) { person in row(person) }
                        }
                    }
                } else if let errorMessage {
                    ErrorState(message: errorMessage) { await load() }
                } else {
                    SkeletonRows(count: 4)
                }
            }
            talkBar
        }
        .navigationTitle(L("Walkie-talkie"))
        .navigationBarTitleDisplayMode(.inline)
        .neonAmbientBackground()
        .task { await load() }
        .refreshable { await load() }
    }

    private func everybodyRow(count: Int) -> some View {
        choice(id: "all", enabled: true) {
            IconTile("person.3.fill", hue: .orange, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                Text(L("Everybody")).font(.neonRowTitle).foregroundStyle(Color.neonInk)
                Text(L("%d with it on", count)).font(.neonCaption).foregroundStyle(Color.neonTextTertiary)
            }
        }
    }

    private func row(_ person: WalkiePerson) -> some View {
        choice(id: person.id, enabled: person.allowed) {
            AvatarView(url: facePhotoURL(person.photoUrl), name: person.shownName, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                DirText(person.shownName, font: .neonRowTitle, fill: false, lineLimit: 1)
                Text(person.allowed ? L("Walkie-talkie on") : L("Not turned on yet"))
                    .font(.neonCaption)
                    .foregroundStyle(person.allowed ? Color.neonSuccessStrong : Color.neonTextTertiary)
            }
        }
    }

    private func choice<Content: View>(id: String, enabled: Bool, @ViewBuilder content: () -> Content) -> some View {
        let selected = chosen == id
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        return Button {
            guard enabled else { return }
            Haptic.selection()
            withNeonAnimation(NeonMotion.snappy) { chosen = id }
            // iOS's own talk button, held on the lock screen, speaks to them too.
            WalkieCenter.target = id
        } label: {
            HStack(spacing: 12) {
                content()
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(Color.neonAccent)
                }
            }
            .padding(10)
            .background(shape.fill(selected ? NeonHue.orange.wash : Color.white.opacity(0.6)))
            .overlay(shape.strokeBorder(selected ? Color.neonOrange.opacity(0.5) : Color.neonLine, lineWidth: 1))
            .opacity(enabled ? 1 : 0.55)
        }
        .buttonStyle(.pressableCard)
        .disabled(!enabled)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    /// The button: held, it records; let go, it sends. Too short a press is
    /// not sent — it is almost always a tap that meant something else.
    private var talkBar: some View {
        VStack(spacing: 10) {
            if let note = recorder.problem ?? lastSent {
                Text(note)
                    .font(.neonFootnote)
                    .foregroundStyle(recorder.problem != nil ? Color.neonDangerStrong : Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let ready = target != nil && !sending && open
            ZStack {
                Circle()
                    .fill(recorder.recording ? AnyShapeStyle(Color.neonDanger) : AnyShapeStyle(ready ? LinearGradient.neonAccent : LinearGradient(colors: [.gray.opacity(0.4)], startPoint: .top, endPoint: .bottom)))
                    .frame(width: 112, height: 112)
                    .scaleEffect(recorder.recording ? 1.08 + recorder.level * 0.12 : 1)
                    .shadow(color: (recorder.recording ? Color.neonDanger : Color.neonAccent).opacity(ready ? 0.35 : 0), radius: 16, x: 0, y: 6)
                if sending {
                    ProgressView().tint(.white).controlSize(.large)
                } else {
                    Image(systemName: recorder.recording ? "waveform" : "mic.fill")
                        .font(.system(size: 38, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .animation(.easeOut(duration: 0.12), value: recorder.level)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard ready, !recorder.recording else { return }
                        lastSent = nil
                        Haptic.impact(.medium)
                        recorder.start()
                    }
                    .onEnded { _ in
                        guard recorder.recording else { return }
                        Task { await release() }
                    }
            )
            .accessibilityLabel(L("Hold to talk"))
            Text(target.map { recorder.recording ? L("Talking to %@ — let go to send", $0.name) : L("Hold to talk to %@", $0.name) } ?? L("Choose who to talk to"))
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(Color.neonInk)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, 14)
        .padding(.bottom, 18)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
    }

    private func release() async {
        guard let result = recorder.stop(), let target else { return }
        // The channel closing, on the speaker's own phone.
        WalkieRadio.shared.squelch()
        guard result.seconds >= 0.6 else {
            lastSent = L("Hold the button while you speak, then let go.")
            return
        }
        sending = true
        Haptic.soft()
        do {
            let sent = try await api.sendWalkie(to: target.id, audio: result.data, seconds: result.seconds)
            Haptic.success()
            lastSent = sent.map(Self.said) ?? L("Sent.")
        } catch {
            Haptic.error()
            lastSent = error.localizedDescription
        }
        sending = false
    }

    /// Who heard it, and who has not turned it on — as they are, never "sent"
    /// over a phone that heard nothing.
    private static func said(_ sent: WalkieSent) -> String {
        let names = { (list: [String]) in list.map { L($0) }.joined(separator: L(", ")) }
        var lines: [String] = []
        lines.append(sent.heard.isEmpty ? L("No phone took it. Their phones may be off.") : L("Heard on: %@", names(sent.heard)))
        if !sent.notOn.isEmpty { lines.append(L("Not turned on yet: %@", names(sent.notOn))) }
        return lines.joined(separator: "\n")
    }

    private func load() async {
        #if DEBUG
        if preview != nil { return }
        #endif
        do {
            let loaded = try await api.fetchWalkiePeople()
            people = loaded.value.people
            open = loaded.value.open ?? true
            errorMessage = nil
        } catch {
            if people == nil { errorMessage = error.localizedDescription }
        }
    }
}

/// The manager's microphone, for one press: AAC in an .m4a, which an iPhone
/// plays as it is.
@MainActor
final class WalkieRecorder: NSObject, ObservableObject {
    @Published private(set) var recording = false
    @Published private(set) var level: CGFloat = 0
    @Published var problem: String?

    private var recorder: AVAudioRecorder?
    private var meter: Timer?
    private var startedAt: Date?

    private var file: URL { FileManager.default.temporaryDirectory.appendingPathComponent("walkie.m4a") }

    func start() {
        problem = nil
        if CallCenter.shared.session != nil {
            problem = L("You can't use the walkie-talkie during a call.")
            return
        }
        let session = AVAudioSession.sharedInstance()
        guard session.recordPermission != .denied else {
            problem = L("Allow the microphone for NEON in Settings to use the walkie-talkie.")
            return
        }
        if session.recordPermission == .undetermined {
            session.requestRecordPermission { _ in }
            return
        }
        do {
            ChatVoicePlayer.shared.stop()
            try session.setCategory(.playAndRecord, mode: .spokenAudio, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            try? FileManager.default.removeItem(at: file)
            let recorder = try AVAudioRecorder(url: file, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 22_050,
                AVNumberOfChannelsKey: 1,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ])
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: 60) else { throw CocoaError(.fileWriteUnknown) }
            self.recorder = recorder
            startedAt = Date()
            recording = true
            meter = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
                Task { @MainActor in
                    guard let self, let recorder = self.recorder else { return }
                    recorder.updateMeters()
                    self.level = CGFloat(max(0, min(1, (recorder.averagePower(forChannel: 0) + 50) / 50)))
                }
            }
        } catch {
            problem = L("The microphone could not start. Try again.")
        }
    }

    /// Stops, and hands back what was said.
    func stop() -> (data: Data, seconds: Double)? {
        guard let recorder else { return nil }
        let seconds = recorder.currentTime > 0 ? recorder.currentTime : Date().timeIntervalSince(startedAt ?? Date())
        recorder.stop()
        meter?.invalidate()
        meter = nil
        self.recorder = nil
        recording = false
        level = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let data = try? Data(contentsOf: file), !data.isEmpty else { return nil }
        return (data, seconds)
    }
}
