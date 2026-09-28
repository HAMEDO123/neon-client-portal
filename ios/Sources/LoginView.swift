import SwiftUI

/// Signing in. Somebody on the team uses their email and password; the manager
/// uses the studio's single admin password, with no email. The server's answer
/// says which side this is, and the app follows it.
struct LoginView: View {
    private enum Who: String {
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
    @FocusState private var focused: Field?

    private enum Field { case email, password }

    private var who: Who { Who(rawValue: whoRaw) ?? .team }

    private var canSubmit: Bool {
        !loading && !password.isEmpty && (who == .manager || email.contains("@"))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 26) {
                HStack {
                    Spacer()
                    Button {
                        Haptic.tap()
                        AppLanguage.toggle()
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "globe")
                                .font(.system(size: 12, weight: .semibold))
                            Text(AppLanguage.current.toggleLabel)
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundStyle(Color.neonInk.opacity(0.6))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.white.opacity(0.6), in: Capsule())
                        .overlay(Capsule().strokeBorder(Color.neonInk.opacity(0.1), lineWidth: 1))
                    }
                    .buttonStyle(.pressable)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)

                VStack(spacing: 6) {
                    Text("NEON")
                        .font(.system(size: 40, weight: .heavy, design: .rounded))
                        .foregroundStyle(LinearGradient.neonWordmark)
                    Text(L("The studio"))
                        .font(.system(size: 18, weight: .medium, design: .rounded))
                        .foregroundStyle(Color.neonInk.opacity(0.55))
                }
                .padding(.top, 40)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 8)

                if api.signedOutNotice {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "lock.fill")
                        Text(L("You have been signed out. Sign in again."))
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.neonOrangeStrong)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.neonOrange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .padding(.horizontal, 32)
                }

                VStack(spacing: 14) {
                    Picker("", selection: $whoRaw) {
                        Text(L("Team")).tag(Who.team.rawValue)
                        Text(L("Manager")).tag(Who.manager.rawValue)
                    }
                    .pickerStyle(.segmented)
                    .onChange(of: whoRaw) { _ in
                        error = nil
                        password = ""
                    }

                    if who == .team {
                        field {
                            TextField(L("Email"), text: $email)
                                .keyboardType(.emailAddress)
                                .textContentType(.username)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focused, equals: .email)
                                .submitLabel(.next)
                                .onSubmit { focused = .password }
                                .environment(\.layoutDirection, .leftToRight)
                        }
                    }

                    field {
                        SecureField(who == .manager ? L("Admin password") : L("Password"), text: $password)
                            .textContentType(.password)
                            .focused($focused, equals: .password)
                            .submitLabel(.go)
                            .onSubmit { Task { await login() } }
                    }

                    if let error {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }

                    Button {
                        Task { await login() }
                    } label: {
                        ZStack {
                            Text(L("Sign In"))
                                .font(.system(size: 16, weight: .semibold, design: .rounded))
                                .opacity(loading ? 0 : 1)
                            if loading {
                                ProgressView().tint(.white)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                    }
                    .background(Color.neonInk, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .foregroundStyle(.white)
                    .disabled(!canSubmit)
                    .opacity(canSubmit || loading ? 1 : 0.5)
                    .scaleEffect(loading ? 0.98 : 1)
                    .animation(.spring(response: 0.3, dampingFraction: 0.7), value: loading)
                }
                .padding(.horizontal, 32)
                .disabled(loading)
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 14)

                Text(L("NEON Design & Programming"))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.neonInk.opacity(0.3))
                    .padding(.top, 40)
                    .padding(.bottom, 12)
                    .opacity(appeared ? 1 : 0)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .neonAmbientBackground()
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) { appeared = true }
        }
    }

    private func field<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(.horizontal, 16)
            .frame(height: 50)
            .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.neonInk.opacity(0.1), lineWidth: 1)
            )
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
            withAnimation { self.error = who == .manager ? L("Invalid password.") : L("Invalid email or password.") }
            Haptic.error()
        } catch {
            withAnimation { self.error = error.localizedDescription }
            Haptic.error()
        }
    }
}

#Preview {
    LoginView().environmentObject(APIClient.shared)
}
