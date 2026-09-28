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
    @State private var saving = false
    @State private var forgetting: ProfileDevice?

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
                        .font(.system(size: 11))
                        .foregroundStyle(Color.neonInk.opacity(0.35))
                        .frame(maxWidth: .infinity, alignment: .center)

                    NeonButton(L("Sign Out"), symbol: "rectangle.portrait.and.arrow.right", kind: .secondary, confirm: L("Sign out of NEON?")) {
                        api.logout()
                    }
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
        .confirmDestructive(item: $forgetting, title: { L("Forget %@?", $0.label) }, actionTitle: L("Forget device")) { device in
            Task { await forget(device) }
        }
    }

    private func identityCard(_ employee: ProfileEmployee, deviceCount: Int) -> some View {
        NeonCard {
            DirText(employee.name, font: .system(size: 20, weight: .bold, design: .rounded))
            DirText(employee.role ?? L("Employee"), font: .system(size: 13), color: .neonInk.opacity(0.5))
            NeonDivider()
            if let email = employee.email, !email.isEmpty { profileLine(symbol: "envelope", value: email) }
            if let phone = employee.phone, !phone.isEmpty { profileLine(symbol: "phone", value: phone) }
            if let code = employee.employeeCode, !code.isEmpty { profileLine(symbol: "person.text.rectangle", value: "ID \(code)") }
            profileLine(symbol: "smartphone", value: L("%d device(s) receiving push", deviceCount))
        }
    }

    private func profileLine(symbol: String, value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 13)).foregroundStyle(Color.neonInk.opacity(0.35)).frame(width: 16)
            Text(value).font(.system(size: 14)).foregroundStyle(Color.neonInk.opacity(0.75))
            Spacer()
        }
    }

    private func preferencesCard(_ preferences: Binding<ProfilePreferences>) -> some View {
        NeonCard {
            SectionLabel(L("What to notify me about"))

            ToggleRow(L("Send to my devices"), detail: L("Turn off to keep notifications in-app only"), symbol: "iphone.radiowaves.left.and.right", isOn: preferences.pushEnabled)
            NeonDivider()
            ToggleRow(L("Team messages"), detail: L("When someone writes in the team chat"), symbol: "bubble.left.and.bubble.right", isOn: preferences.chatMessages)
            ToggleRow(L("Task assigned"), detail: L("When an admin gives you a new task"), symbol: "tray.and.arrow.down", isOn: preferences.taskAssigned)
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
                .font(.system(size: 12))
                .foregroundStyle(Color.neonInk.opacity(0.45))

            VStack(spacing: 8) {
                ForEach(devices) { device in
                    deviceRow(device)
                }
            }
        }
    }

    private func deviceRow(_ device: ProfileDevice) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "smartphone")
                .font(.system(size: 14))
                .foregroundStyle(device.active ? Color.neonSuccessStrong : Color.neonInk.opacity(0.3))

            VStack(alignment: .leading, spacing: 2) {
                Text(device.label).font(.system(size: 13, weight: .medium)).lineLimit(1)
                Text(device.active ? L("Receiving") : L("Muted"))
                    .font(.system(size: 11))
                    .foregroundStyle(Color.neonInk.opacity(0.4))
            }
            Spacer()

            Toggle("", isOn: Binding(
                get: { device.active },
                set: { newValue in Task { await setActive(device, newValue) } }
            ))
            .labelsHidden()

            Button {
                forgetting = device
            } label: {
                Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(Color.neonInk.opacity(0.3))
            }
        }
        .padding(10)
        .background(Color.white.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: Loading and writing

    private func load() async {
        do {
            let loaded = try await api.fetchProfile()
            data = loaded.value
            preferences = loaded.value.preferences
            cachedAt = loaded.cachedAt
            errorMessage = nil
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
