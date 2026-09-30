import SwiftUI
import UIKit

/// The manager's WhatsApp channel — the same ground as `/admin/settings`'
/// "Company channels" and "Sending" cards, scoped to WhatsApp alone (the
/// timezone and everything else on that page belongs to other areas). Pushed
/// only for whoever `whatsapp/line` lets in — `requireAdmin`, so the gear
/// that opens this is hidden for a ticked employee before the tap even
/// happens (`WhatsAppRootView.canManageLine`), and this view's own read would
/// refuse them anyway if it were reached another way.
struct WhatsAppSettingsView: View {
    @EnvironmentObject var api: APIClient
    @State private var line: WhatsAppLineResponse?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var linkState: WhatsAppLinkState?
    @State private var showLinkPanel = false
    @State private var linkPhone = ""
    @State private var pollTask: Task<Void, Never>?
    @State private var testPhone = ""
    @State private var testText = L("Test message from the NEON app.")
    @State private var testOutcome: WhatsAppOutcome?

    var body: some View {
        NeonScroll {
            LoadStateView(value: line, error: errorMessage, cachedAt: cachedAt, retry: { await load() }) {
                SkeletonRows(count: 3)
            } content: { line in
                channelCard(line)
                transportCard(line)
                testCard(line)
            }
        }
        .navigationTitle(L("WhatsApp settings"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onDisappear { pollTask?.cancel() }
        .sheet(isPresented: $showLinkPanel) { linkPanel }
    }

    // MARK: Cards

    @ViewBuilder
    private func channelCard(_ line: WhatsAppLineResponse) -> some View {
        let connected = line.link?.status == "connected"
        SectionCard(L("WhatsApp"), symbol: "message.fill", hue: .green) {
            if connected {
                Label(line.link?.phoneNumber.map(formattedWhatsAppNumber) ?? L("This number is linked"), systemImage: "iphone")
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextSecondary)
            } else {
                Text(L("Open WhatsApp on your phone → Settings → Linked devices → Link a device, and scan the code here to send from your own number."))
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextSecondary)
            }

            if !line.workerConfigured {
                StatusNote(
                    symbol: "exclamationmark.triangle.fill",
                    tone: .warning,
                    title: L("The session worker is not running"),
                    detail: L("There is nothing to link to yet.")
                )
            }

            if connected {
                NeonButton(
                    L("Unlink"), symbol: "iphone.slash", kind: .tinted(.neonDangerStrong), size: .medium,
                    confirm: L("Unlink this number?"),
                    confirmMessage: L("Messages will stop going out until it is linked again.")
                ) {
                    await unlink()
                }
            } else {
                NeonButton(L("Link"), symbol: "link", kind: .tinted(.neonSuccessStrong), size: .medium) {
                    await beginLink()
                }
                .disabled(!line.workerConfigured)
            }
        } trailing: {
            if connected { BadgeView(text: L("Linked"), tone: .success, symbol: "checkmark") }
        }
    }

    @ViewBuilder
    private func transportCard(_ line: WhatsAppLineResponse) -> some View {
        SectionCard(L("Sending"), symbol: "paperplane.fill", hue: .blue) {
            if line.transport != "none" {
                if let number = line.connection?.number {
                    KeyValueRow(
                        L("Sends from"),
                        value: formattedWhatsAppNumber(number),
                        symbol: "phone"
                    )
                }
                KeyValueRow(
                    L("Status"),
                    value: line.connection?.ok == true ? L("Sending normally") : L("Not reaching WhatsApp"),
                    symbol: line.connection?.ok == true ? "checkmark.circle" : "exclamationmark.circle"
                )
                DisclosureGroup(L("Technical details")) {
                    VStack(alignment: .leading, spacing: 10) {
                        KeyValueRow(
                            L("Transport"),
                            value: line.transport == "cloud" ? L("Official Cloud API") : L("Session worker (whatsapp-web.js)"),
                            symbol: "antenna.radiowaves.left.and.right"
                        )
                        if let id = line.cloudPhoneNumberId {
                            KeyValueRow(L("Phone number ID"), value: id, symbol: "number")
                        }
                        if let url = line.workerUrl {
                            KeyValueRow(L("Worker"), value: url, symbol: "server.rack")
                        }
                        if let lineId = line.lineId {
                            KeyValueRow(L("Line"), value: lineId, symbol: "number")
                        }
                    }
                    .padding(.top, 8)
                }
                .font(.neonSubheadline)
                .tint(Color.neonTextSecondary)
            } else {
                Text(L("No transport is configured yet — the Cloud API or the session worker's keys still need to be added."))
                    .font(.neonSubheadline)
                    .foregroundStyle(Color.neonTextSecondary)
            }
        } trailing: {
            BadgeView(text: transportBadgeText(line), tone: transportBadgeTone(line))
        }
    }

    @ViewBuilder
    private func testCard(_ line: WhatsAppLineResponse) -> some View {
        SectionCard(L("Send a test"), symbol: "checkmark.message.fill", hue: .purple) {
            NeonTextField(L("Send a test to"), text: $testPhone, prompt: "962790000000", symbol: "phone", keyboard: .phonePad, leftToRight: true)
            NeonTextEditor(L("Message"), text: $testText, minLines: 2, maxLines: 4)
            NeonButton(L("Send test"), symbol: "paperplane.fill", kind: .secondary, size: .medium) {
                await sendTest()
            }
            .disabled(line.connection?.ok != true || testPhone.trimmingCharacters(in: .whitespaces).isEmpty)

            if let testOutcome {
                Text(testOutcome.message)
                    .font(.footnote)
                    .foregroundStyle(testOutcome.ok ? Color.neonSuccessStrong : Color.neonDangerStrong)
            }
        }
    }

    // MARK: Link panel

    private var linkPanel: some View {
        VStack(spacing: 18) {
            SheetHeader(L("Link your number"), symbol: "qrcode", tint: .neonSuccessStrong)

            Group {
                if let qr = linkState?.qrDataUrl, let image = decodeWhatsAppQRImage(qr) {
                    VStack(spacing: 10) {
                        Image(uiImage: image)
                            .resizable()
                            .frame(width: 200, height: 200)
                            .padding(10)
                            .neonSurface(.solid, radius: NeonRadius.md)
                        Text(L("WhatsApp → Settings → Linked devices → Link a device, then scan this."))
                            .font(.footnote)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(Color.neonTextSecondary)
                    }
                } else if let code = linkState?.pairingCode {
                    VStack(spacing: 8) {
                        Text(L("Enter this code on your phone")).font(.footnote).foregroundStyle(Color.neonTextSecondary)
                        Text(code).font(.system(size: 30, weight: .semibold, design: .monospaced)).tracking(4)
                    }
                } else if linkState?.status == "error" {
                    VStack(spacing: 10) {
                        Text(linkState?.error ?? L("Linking failed.")).font(.subheadline).foregroundStyle(Color.neonDangerStrong)
                        NeonButton(L("Try again"), symbol: "arrow.clockwise", kind: .secondary, size: .medium) { await beginLink() }
                    }
                } else {
                    VStack(spacing: 10) {
                        ProgressView()
                        Text(L("Starting the session — this takes a few seconds.")).font(.footnote).foregroundStyle(Color.neonTextSecondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 180)

            if linkState?.qrDataUrl == nil && linkState?.pairingCode == nil && linkState?.status != "error" {
                VStack(alignment: .leading, spacing: 8) {
                    NeonTextField(L("Or link by code, with your number"), text: $linkPhone, prompt: "962790000000", keyboard: .phonePad, leftToRight: true)
                    NeonButton(L("Get code"), kind: .secondary, size: .medium) { await beginLink() }
                }
            }

            Text(linkState?.status == "pending" ? L("Waiting for the scan…") : L("The code refreshes on its own."))
                .font(.caption)
                .foregroundStyle(linkState?.status == "pending" ? Color.neonCyanStrong : Color.neonTextTertiary)
        }
        .padding(NeonSpace.gutter)
        .neonSheet([.medium])
        .onAppear { startPolling() }
        .onDisappear { pollTask?.cancel() }
    }

    // MARK: Reading and acting

    private func load() async {
        do {
            let loaded = try await api.fetchWhatsAppLine()
            line = loaded.value
            cachedAt = loaded.cachedAt
            linkState = loaded.value.link
            errorMessage = nil
        } catch {
            if line == nil { errorMessage = error.localizedDescription }
        }
    }

    private func beginLink() async {
        do {
            linkState = try await api.startWhatsAppLink(phone: linkPhone.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "\\D", with: "", options: .regularExpression))
            showLinkPanel = true
            startPolling()
        } catch {
            Toast.error(error)
        }
    }

    /// While a code is on screen it is only worth anything until it is
    /// scanned, so the session is watched until it connects.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                if Task.isCancelled { break }
                guard let updated = try? await api.fetchWhatsAppLinkStatus() else { continue }
                linkState = updated
                if updated.status == "connected" {
                    Haptic.success()
                    showLinkPanel = false
                    await load()
                    break
                }
            }
        }
    }

    private func unlink() async {
        do {
            let outcome = try await api.unlinkWhatsAppLine()
            Toast.success(outcome?.message ?? L("The number has been unlinked."))
            await load()
        } catch {
            Toast.error(error)
        }
    }

    private func sendTest() async {
        do {
            testOutcome = try await api.sendTestWhatsApp(
                phone: testPhone.trimmingCharacters(in: .whitespaces),
                text: testText.trimmingCharacters(in: .whitespacesAndNewlines)
            )
        } catch {
            testOutcome = WhatsAppOutcome(ok: false, message: error.localizedDescription)
        }
    }
}

private func transportBadgeText(_ line: WhatsAppLineResponse) -> String {
    if line.transport == "none" { return L("Not configured") }
    // "Connected", not "Working" — the latter already means "in progress"
    // elsewhere in the app (Home's task state), and L() has no per-screen
    // sense of a key, so reusing it here would show that meaning instead.
    return line.connection?.ok == true ? L("Connected") : L("Unreachable")
}

private func transportBadgeTone(_ line: WhatsAppLineResponse) -> BadgeTone {
    if line.transport == "none" { return .neutral }
    return line.connection?.ok == true ? .success : .warning
}

private func decodeWhatsAppQRImage(_ dataURL: String) -> UIImage? {
    guard let comma = dataURL.firstIndex(of: ",") else { return nil }
    let base64 = String(dataURL[dataURL.index(after: comma)...])
    guard let data = Data(base64Encoded: base64) else { return nil }
    return UIImage(data: data)
}
