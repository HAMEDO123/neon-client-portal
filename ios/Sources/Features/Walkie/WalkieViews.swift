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
                        point("clock.fill", L("Everybody from 10 AM to 7 PM. At night it is one person to one person, for those the studio allows."))
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
    var lastAt: String? = nil
    var unheard: Int? = nil

    /// "The manager" is the server's word, said in the app's language.
    var shownName: String { manager == true ? L("The manager") : name }
}

struct WalkiePeopleResponse: Decodable {
    /// Inside the walkie-talkie's hours: it speaks only then.
    let open: Bool?
    let people: [WalkiePerson]
    var all: Latest? = nil
    struct Latest: Decodable { let lastAt: String? }
}

struct WalkieSent: Decodable {
    let batch: String?
    /// Who had a phone Apple took it for, and who has not turned it on.
    let heard: [String]
    let notOn: [String]
    let phones: Int
}

/// One thing said in a conversation (`walkie/thread`).
struct WalkieItem: Decodable, Identifiable, Equatable {
    let id: String
    let mine: Bool
    let fromName: String
    let scope: String
    let audioUrl: String
    let seconds: Int?
    let at: String
    let phones: Int
    let heardAt: String?
    var recipients: [Recipient]? = nil

    struct Recipient: Decodable, Equatable {
        let key: String
        let phones: Int
        let heardAt: String?
    }
}

struct WalkieThreadResponse: Decodable { let items: [WalkieItem] }

extension APIClient {
    func fetchWalkiePeople() async throws -> Loaded<WalkiePeopleResponse> {
        try await read("walkie/people", as: WalkiePeopleResponse.self)
    }

    func fetchWalkieThread(with key: String) async throws -> [WalkieItem] {
        try await readFresh("walkie/thread", ["with": key], as: WalkieThreadResponse.self).items
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

    /// This phone has played it: the speaker sees "heard".
    func markWalkieHeard(_ id: String) async {
        _ = try? await perform("walkie/heard", args: [id])
    }
}

/// Everybody to talk to, each a conversation — as a chat list: the last time
/// you spoke, what of theirs you have not heard, and whether their walkie-talkie
/// is on. The manager and the team alike.
struct WalkieTalkieView: View {
    @EnvironmentObject var api: APIClient
    @ObservedObject private var center = WalkieCenter.shared
    @State private var people: [WalkiePerson]?
    @State private var allLastAt: String?
    @State private var open = true
    @State private var errorMessage: String?
    @State private var opened: WalkieConversation?
    #if DEBUG
    private var preview: [WalkiePerson]?
    init(preview: [WalkiePerson]? = nil, open: Bool = true) {
        self.preview = preview
        _people = State(initialValue: preview)
        _open = State(initialValue: open)
    }
    #endif

    var body: some View {
        NeonScroll(spacing: NeonSpace.stack, lazy: false) {
            WalkieHearCard()
            if !open {
                StatusNote(symbol: "clock.fill", tone: .info, title: L("The walkie-talkie is closed for you now. It opens at 10 AM."), detail: nil)
            }
            if let people {
                let on = people.filter(\.allowed).count
                VStack(spacing: 8) {
                    row(WalkieConversation(key: "all", name: L("Everybody"), photo: nil),
                        subtitle: L("%d with it on", on), lastAt: allLastAt, unheard: 0, allowed: true, everybody: true)
                    ForEach(people) { person in
                        row(WalkieConversation(key: person.id, name: person.shownName, photo: person.photoUrl),
                            subtitle: person.allowed ? L("Walkie-talkie on") : L("Not turned on yet"),
                            lastAt: person.lastAt, unheard: person.unheard ?? 0, allowed: person.allowed, everybody: false)
                    }
                }
            } else if let errorMessage {
                ErrorState(message: errorMessage) { await load() }
            } else {
                SkeletonRows(count: 4)
            }
        }
        .navigationTitle(L("Walkie-talkie"))
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: Binding(get: { opened != nil }, set: { if !$0 { opened = nil } })) {
            if let opened { WalkieThreadView(conversation: opened, open: open) }
        }
        .task { await load() }
        .refreshable { await load() }
        // Something came in while this was open: its row moves.
        .onChange(of: center.heardCount) { _ in Task { await load() } }
    }

    private func row(_ conversation: WalkieConversation, subtitle: String, lastAt: String?, unheard: Int, allowed: Bool, everybody: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: NeonRadius.md, style: .continuous)
        return Button {
            Haptic.tap()
            opened = conversation
        } label: {
            HStack(spacing: 12) {
                if everybody {
                    IconTile("person.3.fill", hue: .orange, size: 46)
                } else {
                    AvatarView(url: facePhotoURL(conversation.photo), name: conversation.name, size: 46)
                }
                VStack(alignment: .leading, spacing: 3) {
                    DirText(conversation.name, font: .neonRowTitle, fill: false, lineLimit: 1)
                    Text(subtitle)
                        .font(.neonCaption)
                        .foregroundStyle(allowed ? Color.neonSuccessStrong : Color.neonTextTertiary)
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 4) {
                    if let time = chatListTime(lastAt) {
                        Text(time).font(.neonCaption).foregroundStyle(Color.neonTextTertiary)
                    }
                    if unheard > 0 { CountBadge(unheard, tone: .danger, size: 20) }
                }
                Image(systemName: "chevron.forward")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.neonTextFaint)
            }
            .padding(10)
            .background(shape.fill(Color.white.opacity(0.75)))
            .overlay(shape.strokeBorder(Color.neonLine, lineWidth: 1))
            .opacity(allowed ? 1 : 0.6)
        }
        .buttonStyle(.pressableCard)
    }

    private func load() async {
        #if DEBUG
        if preview != nil { return }
        #endif
        do {
            let loaded = try await api.fetchWalkiePeople()
            people = loaded.value.people
            allLastAt = loaded.value.all?.lastAt
            open = loaded.value.open ?? true
            errorMessage = nil
        } catch {
            if people == nil { errorMessage = error.localizedDescription }
        }
    }
}

/// Who a conversation is with: "all", "admin", or an employee's id.
struct WalkieConversation: Hashable, Identifiable {
    let key: String
    let name: String
    let photo: String?
    var id: String { key }
}

/// One conversation: what you said and what they said, oldest at the top, each
/// to play again — and for what you said, whether it reached their phone and
/// whether it was heard there, kept up to date while it is open. The button at
/// the foot talks to them.
struct WalkieThreadView: View {
    let conversation: WalkieConversation
    var open = true

    @EnvironmentObject var api: APIClient
    @ObservedObject private var center = WalkieCenter.shared
    @State private var items: [WalkieItem]?
    @State private var errorMessage: String?
    @State private var playingId: String?
    #if DEBUG
    private var preview: [WalkieItem]?
    init(conversation: WalkieConversation, open: Bool = true, preview: [WalkieItem]? = nil) {
        self.conversation = conversation
        self.open = open
        self.preview = preview
        _items = State(initialValue: preview)
    }
    #endif

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 10) {
                        if let items {
                            if items.isEmpty {
                                EmptyState(symbol: "antenna.radiowaves.left.and.right", title: L("Nothing said yet"),
                                           detail: L("Hold the button and speak."), hue: .orange)
                                    .padding(.top, 40)
                            }
                            ForEach(items) { item in bubble(item).id(item.id) }
                        } else if let errorMessage {
                            ErrorState(message: errorMessage) { await load() }
                        } else {
                            ProgressView().padding(.top, 60)
                        }
                        Color.clear.frame(height: 4).id("end")
                    }
                    .padding(NeonSpace.gutter)
                }
                .onChange(of: items?.count ?? 0) { _ in
                    withAnimation { proxy.scrollTo("end", anchor: .bottom) }
                }
                .onAppear { proxy.scrollTo("end", anchor: .bottom) }
            }
            WalkieTalkBar(target: conversation.key, name: conversation.name, open: open) {
                await load()
            }
        }
        .navigationTitle(conversation.name)
        .navigationBarTitleDisplayMode(.inline)
        .neonAmbientBackground()
        .onAppear { WalkieCenter.target = conversation.key }
        // While it is open: "reached" and "heard" arrive as the other phone says so.
        .task {
            #if DEBUG
            if preview != nil { return }
            #endif
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 2_500_000_000)
            }
        }
        .onChange(of: center.heardCount) { _ in Task { await load() } }
    }

    private func bubble(_ item: WalkieItem) -> some View {
        let shape = RoundedRectangle(cornerRadius: 18, style: .continuous)
        return HStack {
            if item.mine { Spacer(minLength: 48) }
            VStack(alignment: .leading, spacing: 6) {
                if !item.mine, item.scope == "all" {
                    Text(L("To everybody"))
                        .font(.system(.caption2, weight: .semibold))
                        .foregroundStyle(Color.neonOrangeStrong)
                }
                HStack(spacing: 10) {
                    Button {
                        Task { await play(item) }
                    } label: {
                        Image(systemName: playingId == item.id ? "speaker.wave.2.fill" : "play.fill")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(item.mine ? Color.neonAccent : Color.white)
                            .frame(width: 34, height: 34)
                            .background(Circle().fill(item.mine ? Color.white : Color.neonOrangeStrong))
                    }
                    .buttonStyle(PressableStyle(scale: 0.9))
                    .accessibilityLabel(L("Play"))
                    Image(systemName: "waveform")
                        .font(.system(size: 20))
                        .foregroundStyle(item.mine ? Color.white.opacity(0.8) : Color.neonTextSecondary)
                    if let seconds = item.seconds {
                        Text(Self.length(seconds))
                            .font(.system(.footnote, weight: .medium))
                            .monospacedDigit()
                            .foregroundStyle(item.mine ? Color.white.opacity(0.9) : Color.neonTextSecondary)
                    }
                }
                HStack(spacing: 6) {
                    Text(chatClock(item.at))
                        .font(.system(.caption2))
                        .foregroundStyle(item.mine ? Color.white.opacity(0.75) : Color.neonTextTertiary)
                    if item.mine { status(item) }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(shape.fill(item.mine ? AnyShapeStyle(LinearGradient.neonAccent) : AnyShapeStyle(Color.white)))
            .overlay(shape.strokeBorder(item.mine ? Color.clear : Color.neonLine, lineWidth: 1))
            if !item.mine { Spacer(minLength: 48) }
        }
    }

    /// For what I said: not reached, reached, or heard — and for everybody, how many heard it.
    @ViewBuilder
    private func status(_ item: WalkieItem) -> some View {
        if let recipients = item.recipients {
            let heard = recipients.filter { $0.heardAt != nil }.count
            let reached = recipients.filter { $0.phones > 0 }.count
            Text(L("Heard by %d of %d", heard, recipients.count) + (reached < recipients.count ? " · " + L("%d not reached", recipients.count - reached) : ""))
                .font(.system(.caption2, weight: .semibold))
                .foregroundStyle(Color.white)
        } else if item.heardAt != nil {
            Label(L("Heard"), systemImage: "checkmark.circle.fill")
                .font(.system(.caption2, weight: .bold))
                .foregroundStyle(Color.white)
        } else if item.phones > 0 {
            Label(L("Reached, not heard yet"), systemImage: "checkmark")
                .font(.system(.caption2, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.85))
        } else {
            Label(L("Did not reach their phone"), systemImage: "exclamationmark.circle.fill")
                .font(.system(.caption2, weight: .semibold))
                .foregroundStyle(Color.white)
        }
    }

    private static func length(_ seconds: Int) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    private func play(_ item: WalkieItem) async {
        guard let url = resolvedMediaURL(item.audioUrl) else { return }
        playingId = item.id
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let file = FileManager.default.temporaryDirectory.appendingPathComponent("walkie-replay.m4a")
            try data.write(to: file, options: .atomic)
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try? AVAudioSession.sharedInstance().setActive(true)
            try WalkieRadio.shared.play(file: file) { playingId = nil }
            // Played here: heard, if it was theirs to me.
            if !item.mine, item.heardAt == nil { await api.markWalkieHeard(item.id) }
        } catch {
            playingId = nil
        }
    }

    private func load() async {
        #if DEBUG
        if preview != nil { return }
        #endif
        do {
            items = try await api.fetchWalkieThread(with: conversation.key)
            errorMessage = nil
        } catch {
            if items == nil { errorMessage = error.localizedDescription }
        }
    }
}

/// The button at the foot of a conversation: held, it records; let go, it
/// sends. Too short a press is not sent — it is almost always a tap that meant
/// something else.
struct WalkieTalkBar: View {
    let target: String
    let name: String
    var open = true
    let onSent: () async -> Void

    @EnvironmentObject var api: APIClient
    @StateObject private var recorder = WalkieRecorder()
    @State private var sending = false
    @State private var note: String?

    var body: some View {
        VStack(spacing: 10) {
            if let note = recorder.problem ?? note {
                Text(note)
                    .font(.neonFootnote)
                    .foregroundStyle(recorder.problem != nil ? Color.neonDangerStrong : Color.neonTextSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let ready = !sending && open
            ZStack {
                Circle()
                    .fill(recorder.recording ? AnyShapeStyle(Color.neonDanger) : AnyShapeStyle(ready ? LinearGradient.neonAccent : LinearGradient(colors: [.gray.opacity(0.4)], startPoint: .top, endPoint: .bottom)))
                    .frame(width: 96, height: 96)
                    .scaleEffect(recorder.recording ? 1.08 + recorder.level * 0.12 : 1)
                    .shadow(color: (recorder.recording ? Color.neonDanger : Color.neonAccent).opacity(ready ? 0.35 : 0), radius: 14, x: 0, y: 6)
                if sending {
                    ProgressView().tint(.white).controlSize(.large)
                } else {
                    Image(systemName: recorder.recording ? "waveform" : "mic.fill")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
            .animation(.easeOut(duration: 0.12), value: recorder.level)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard ready, !recorder.recording else { return }
                        note = nil
                        Haptic.impact(.medium)
                        recorder.start()
                    }
                    .onEnded { _ in
                        guard recorder.recording else { return }
                        Task { await release() }
                    }
            )
            .accessibilityLabel(L("Hold to talk"))
            Text(recorder.recording ? L("Talking to %@ — let go to send", name) : L("Hold to talk to %@", name))
                .font(.system(.subheadline, weight: .semibold))
                .foregroundStyle(Color.neonInk)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, NeonSpace.gutter)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
    }

    private func release() async {
        guard let result = recorder.stop() else { return }
        WalkieRadio.shared.squelch()
        guard result.seconds >= 0.6 else {
            note = L("Hold the button while you speak, then let go.")
            return
        }
        sending = true
        Haptic.soft()
        do {
            let sent = try await api.sendWalkie(to: target, audio: result.data, seconds: result.seconds)
            Haptic.success()
            if let sent, !sent.notOn.isEmpty {
                note = L("Not turned on yet: %@", sent.notOn.map { L($0) }.joined(separator: L(", ")))
            }
            await onSent()
        } catch {
            Haptic.error()
            // The server's refusals are English sentences; the ones this
            // screen knows are said in the app's language.
            note = L(error.localizedDescription)
        }
        sending = false
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
            recorder.prepareToRecord()
            self.recorder = recorder
            recording = true
            // The police radio's burst first, then the microphone — heard
            // here, and not recorded into what is said.
            WalkieRadio.shared.chirp()
            DispatchQueue.main.asyncAfter(deadline: .now() + WalkieRadio.chirpSeconds) { [weak self] in
                guard let self, self.recording, let recorder = self.recorder, !recorder.isRecording else { return }
                recorder.record(forDuration: 60)
                self.startedAt = Date()
            }
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
        let seconds = recorder.currentTime > 0 ? recorder.currentTime : (startedAt.map { Date().timeIntervalSince($0) } ?? 0)
        startedAt = nil
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
