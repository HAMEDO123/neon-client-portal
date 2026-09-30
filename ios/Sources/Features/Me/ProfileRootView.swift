import PhotosUI
import SwiftUI

/// `/employee/profile`: who this is, what to be notified about, and which
/// devices are registered. The website's push toggle and sound switch are
/// browser things this native app has no equivalent of — web push is issued
/// to a service-worker subscription, and this app has none — so only the
/// preferences that shape what the platform records (and would push to a
/// browser elsewhere) are offered here.
struct ProfileRootView: View {
    @EnvironmentObject var api: APIClient
    @State private var data: ProfileResponse?
    @State private var preferences: ProfilePreferences?
    @State private var cachedAt: Date?
    @State private var errorMessage: String?
    @State private var refusedMessage: String?
    @State private var saving = false
    @State private var forgetting: ProfileDevice?
    @State private var photoItem: PhotosPickerItem?
    @State private var savingPhoto = false
    /// Set the moment it is saved, so the new face is on screen before the
    /// next read comes back — a picture that appears only after a pull-to-
    /// refresh reads as nothing having happened.
    @State private var photoUrl: String??

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let cachedAt { OfflineBanner(savedAt: cachedAt) }

                if let data {
                    identityCard(data.employee, deviceCount: data.devices.filter(\.active).count)
                    if let preferences {
                        preferencesCard(Binding(get: { preferences }, set: { self.preferences = $0 }))
                    }
                    if !data.devices.isEmpty { devicesCard(data.devices) }

                    Text(L("Times shown in %@", data.timezone.replacingOccurrences(of: "_", with: " ")))
                        .font(.neonCaption)
                        .foregroundStyle(Color.neonTextTertiary)
                        .frame(maxWidth: .infinity, alignment: .center)

                    // Not a second Sign Out — More already carries the one
                    // action a person takes here, and duplicating it only
                    // invites signing out from the wrong screen by habit.
                } else if let refusedMessage {
                    // A permanent refusal ("that is not available to you") —
                    // Retry can never succeed against it, so this reads as a
                    // boundary instead of a broken Retry button.
                    EmptyState(symbol: "lock.fill", title: L("This page is for the team"), detail: refusedMessage, hue: .grey, card: true)
                } else if let errorMessage {
                    ErrorState(message: errorMessage) { await load() }
                } else {
                    SkeletonRows(count: 4)
                }
            }
            .padding(16)
        }
        .refreshable {
            Haptic.tap()
            await load()
        }
        .navigationTitle(L("Profile"))
        .neonAmbientBackground()
        .task { await load() }
        .onChange(of: photoItem) { picked in
            guard let picked else { return }
            Task {
                // Shrunk the way every other upload in the app is, through
                // UploadMaker — the server squares it to 512 afterwards.
                guard let file = await UploadMaker.photo(picked) else {
                    errorMessage = L("That photo could not be read.")
                    photoItem = nil
                    return
                }
                await save(file)
                photoItem = nil
            }
        }
        .confirmDestructive(item: $forgetting, title: { L("Forget %@?", $0.label) }, actionTitle: L("Forget device")) { device in
            Task { await forget(device) }
        }
    }

    private func identityCard(_ employee: ProfileEmployee, deviceCount: Int) -> some View {
        // What was just saved wins over what was last read.
        let face = (photoUrl ?? employee.photoUrl).flatMap(URL.init(string:))

        return NeonCard {
            HStack(spacing: 14) {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    ZStack {
                        AvatarView(url: face, name: employee.name, size: 56, style: .solid)
                        // A camera over the face, so it reads as something to
                        // tap rather than a picture of them.
                        Circle()
                            .fill(Color.black.opacity(savingPhoto ? 0.45 : 0.28))
                            .frame(width: 22, height: 22)
                            .overlay {
                                if savingPhoto {
                                    ProgressView().controlSize(.small).tint(.white)
                                } else {
                                    Image(systemName: "camera.fill")
                                        .font(.system(size: 10, weight: .bold))
                                        .foregroundStyle(Color.white)
                                }
                            }
                            .offset(x: 18, y: 18)
                    }
                }
                .disabled(savingPhoto)

                VStack(alignment: .leading, spacing: 2) {
                    DirText(employee.name, font: .neonTitle3)
                    DirText(employee.role ?? L("Employee"), font: .neonSubtitle, color: .neonTextSecondary)
                    if face == nil {
                        Text(L("Tap your picture to add a photo"))
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextTertiary)
                    } else {
                        Button(L("Remove photo")) { Task { await save(nil) } }
                            .font(.neonCaption)
                            .foregroundStyle(Color.neonTextTertiary)
                            .disabled(savingPhoto)
                    }
                }
                Spacer(minLength: 0)
            }
            NeonDivider()
            if let email = employee.email, !email.isEmpty { profileLine(symbol: "envelope.fill", hue: .blue, value: email) }
            if let phone = employee.phone, !phone.isEmpty { profileLine(symbol: "phone.fill", hue: .green, value: phone) }
            if let code = employee.employeeCode, !code.isEmpty { profileLine(symbol: "person.text.rectangle.fill", hue: .purple, value: "ID \(code)") }
            profileLine(symbol: "iphone.gen3", hue: .cyan, value: L("%d device(s) receiving push", deviceCount))
        }
        .neonAppear()
    }

    /// Saves a face, or takes it off with `nil`.
    private func save(_ file: UploadFile?) async {
        savingPhoto = true
        defer { savingPhoto = false }

        do {
            photoUrl = .some(try await api.setMyPhoto(file))
            Haptic.tap()
        } catch {
            // The server says what to do about a file it cannot read; that
            // sentence is more use than "upload failed".
            errorMessage = error.localizedDescription
        }
    }

    private func profileLine(symbol: String, hue: NeonHue, value: String) -> some View {
        HStack(spacing: 10) {
            IconTile(symbol, hue: hue, size: 28)
            Text(value).font(.neonSubtitle).foregroundStyle(Color.neonInk.opacity(0.82))
            Spacer()
        }
    }

    private func preferencesCard(_ preferences: Binding<ProfilePreferences>) -> some View {
        NeonCard {
            SectionLabel(L("What to notify me about"))

            ToggleRow(L("Send to my devices"), detail: L("Turn off to keep notifications in-app only"), symbol: "iphone.radiowaves.left.and.right", isOn: preferences.pushEnabled)
            NeonDivider()
            ToggleRow(L("Team messages"), detail: L("When someone writes in the team chat"), symbol: "bubble.left.and.bubble.right", isOn: preferences.chatMessages)
            ToggleRow(L("Task assigned"), detail: L("When somebody hands you work"), symbol: "tray.and.arrow.down", isOn: preferences.taskAssigned)
            ToggleRow(L("Task updated"), detail: L("When one of your tasks changes"), symbol: "pencil", isOn: preferences.taskUpdated)
            ToggleRow(L("Today's schedule"), detail: L("A morning summary of today's work"), symbol: "sun.max", isOn: preferences.todaySchedule)
            ToggleRow(L("Tomorrow's schedule"), detail: L("The afternoon summary of tomorrow"), symbol: "sunset", isOn: preferences.tomorrowSchedule)
            ToggleRow(L("Deadline reminders"), detail: L("Before a task with a deadline is due"), symbol: "alarm", isOn: preferences.deadlineReminders)

            NumberField(L("Remind me before a deadline"), value: preferences.deadlineLeadMinutes, unit: L("min"))

            NeonButton(L("Save preferences"), symbol: "checkmark", isLoading: saving) {
                await save(preferences.wrappedValue)
            }
        }
    }

    private func devicesCard(_ devices: [ProfileDevice]) -> some View {
        NeonCard {
            SectionLabel(L("Your devices"))
            Text(L("Only these receive your notifications. Turn one off to keep it quiet without switching push off everywhere."))
                .font(.neonSubtitle)
                .foregroundStyle(Color.neonTextSecondary)

            VStack(spacing: 8) {
                ForEach(devices) { device in
                    deviceRow(device)
                }
            }
        }
    }

    private func deviceRow(_ device: ProfileDevice) -> some View {
        HStack(spacing: 10) {
            IconTile("iphone.gen3", hue: device.active ? .green : .grey, size: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(device.label).font(.neonSubtitle).lineLimit(1)
                Text(device.active ? L("Receiving") : L("Muted"))
                    .font(.neonCaption)
                    .foregroundStyle(Color.neonTextTertiary)
            }
            Spacer()

            Toggle("", isOn: Binding(
                get: { device.active },
                set: { newValue in Task { await setActive(device, newValue) } }
            ))
            .labelsHidden()
            .tint(.neonSuccessStrong)

            // A 44 pt touch target with a spoken label, not a bare 13 pt
            // glyph beside a Toggle — the two controls were nearly
            // indistinguishable by touch before this.
            IconButton("trash", label: L("Forget device"), look: .plain, tint: .neonTextFaint, size: NeonSize.touch) {
                forgetting = device
            }
        }
        .padding(10)
        .neonSurface(.solid, radius: NeonRadius.md)
    }

    // MARK: Loading and writing

    private func load() async {
        do {
            let loaded = try await api.fetchProfile()
            data = loaded.value
            preferences = loaded.value.preferences
            cachedAt = loaded.cachedAt
            errorMessage = nil
            refusedMessage = nil
        } catch APIError.refused(let message) {
            if data == nil { refusedMessage = message }
        } catch {
            if data == nil { errorMessage = error.localizedDescription }
        }
    }

    private func save(_ preferences: ProfilePreferences) async {
        saving = true
        defer { saving = false }
        do {
            try await api.savePreferences(preferences)
            Haptic.success()
            Toast.success(L("Saved"))
        } catch {
            Haptic.error()
            Toast.error(error.localizedDescription)
        }
    }

    private func setActive(_ device: ProfileDevice, _ active: Bool) async {
        do {
            try await api.setProfileDeviceActive(id: device.id, active: active)
            Haptic.selection()
            await load()
        } catch {
            Toast.error(error.localizedDescription)
        }
    }

    private func forget(_ device: ProfileDevice) async {
        do {
            try await api.forgetProfileDevice(id: device.id)
            Haptic.success()
            await load()
        } catch {
            Toast.error(error.localizedDescription)
        }
    }
}
