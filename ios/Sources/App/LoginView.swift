import SwiftUI

/// Signing in. Somebody on the team uses their email and password; the manager
/// uses the studio's single admin password, with no email. The server's answer
/// says which side this is, and the app follows it.
struct LoginView: View {
    private enum Who: String, CaseIterable {
        case team, manager
    }

    @EnvironmentObject var api: APIClient
    // The side last used on this phone, so a returning person lands on their
    // own form. The email is remembered too — never the password.
    @AppStorage("login_who") private var whoRaw = Who.team.rawValue
    @AppStorage("login_email") private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var loading = false
    @State private var appeared = false
    @State private var shakes = 0
    @FocusState private var emailFocused: Bool
    @FocusState private var passwordFocused: Bool

    private var who: Who { Who(rawValue: whoRaw) ?? .team }

    private var whoBinding: Binding<Who> {
        Binding(get: { who }, set: { whoRaw = $0.rawValue })
    }

    private var canSubmit: Bool {
        !loading && !password.isEmpty && (who == .manager || email.contains("@"))
    }

    var body: some View {
        #if DEBUG
        // The design kit's catalogue, for building screens: launch with -neonKitGallery.
        if ProcessInfo.processInfo.arguments.contains("-neonKitGallery") {
            NeonKitGallery()
        } else {
            signIn
        }
        #else
        signIn
        #endif
    }

    private var signIn: some View {
        ScrollView {
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Chip(AppLanguage.current.toggleLabel, symbol: "globe") {
                        AppLanguage.toggle()
                    }
                }
                .padding(.top, 8)

                VStack(spacing: 10) {
                    BrandMark(size: 80)
                    NeonWordmark(size: 40)
                        .padding(.top, 2)
                    Text(L("The studio"))
                        .font(.system(size: 17, weight: .medium, design: .rounded))
                        .foregroundStyle(Color.neonTextSecondary)
                }
                .padding(.top, 18)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 10)

                if api.signedOutNotice {
                    StatusNote(symbol: "lock.fill", tone: .warning, title: L("You have been signed out. Sign in again."))
                        .padding(.top, 24)
                        .transition(.neonRise)
                }

                card
                    .padding(.top, 26)
                    .opacity(appeared ? 1 : 0)
                    .offset(y: appeared ? 0 : 18)

                Text(L("NEON Design & Programming"))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.neonTextFaint)
                    .padding(.top, 36)
                    .padding(.bottom, 16)
                    .opacity(appeared ? 1 : 0)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .neonAmbientBackground(animated: true)
        .onAppear {
            withNeonAnimation(NeonMotion.smooth) { appeared = true }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 16) {
            SegmentedPill(
                selection: whoBinding,
                options: Who.allCases,
                title: { $0 == .team ? L("Team") : L("Manager") },
                symbol: { $0 == .team ? "person.2.fill" : "briefcase.fill" }
            )
            .disabled(loading)
            .onChange(of: whoRaw) { _ in
                withNeonAnimation { error = nil }
                password = ""
            }

            Text(who == .team ? L("Sign in with your work email and password.") : L("Enter the studio's admin password."))
                .font(.system(size: 13))
                .foregroundStyle(Color.neonTextSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .id(who)
                .transition(.opacity)

            if who == .team {
                NeonTextField(
                    L("Email"),
                    text: $email,
                    prompt: "name@example.com",
                    symbol: "envelope",
                    keyboard: .emailAddress,
                    contentType: .username,
                    capitalization: .never,
                    autocorrect: false,
                    leftToRight: true,
                    submitLabel: .next,
                    onSubmit: { passwordFocused = true },
                    focus: $emailFocused
                )
                .disabled(loading)
                .transition(.neonRise)
            }

            NeonTextField(
                who == .manager ? L("Admin password") : L("Password"),
                text: $password,
                prompt: "••••••••",
                symbol: "lock",
                contentType: .password,
                isSecure: true,
                submitLabel: .go,
                onSubmit: { Task { await login() } },
                focus: $passwordFocused
            )
            .disabled(loading)

            if let error {
                ValidationMessage(error)
            }

            NeonButton(L("Sign In"), symbol: "arrow.forward", kind: .primary, isLoading: loading) {
                await login()
            }
            .disabled(!canSubmit && !loading)
            .padding(.top, 4)
        }
        .padding(20)
        .neonSurface(.strong, radius: NeonRadius.xxl)
        .shake(shakes)
        .animation(NeonMotion.smooth, value: who)
        .animation(NeonMotion.snappy, value: error)
    }

    private func login() async {
        guard canSubmit else { return }
        error = nil
        loading = true
        defer { loading = false }
        do {
            let address = email.trimmingCharacters(in: .whitespaces).lowercased()
            try await api.login(email: who == .team ? address : nil, password: password)
            password = ""
            Haptic.success()
        } catch APIError.invalidCredentials {
            refuse(who == .manager ? L("Invalid password.") : L("Invalid email or password."))
        } catch {
            refuse(error.localizedDescription)
        }
    }

    private func refuse(_ message: String) {
        withNeonAnimation { self.error = message }
        shakes += 1
        Haptic.error()
    }
}

#Preview {
    LoginView().environmentObject(APIClient.shared)
}
