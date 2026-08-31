import SwiftUI

struct LoginView: View {
    @EnvironmentObject var api: APIClient
    @State private var password = ""
    @State private var error: String?
    @State private var loading = false
    @State private var appeared = false
    @FocusState private var fieldFocused: Bool

    var body: some View {
        VStack(spacing: 28) {
            Spacer()

            VStack(spacing: 6) {
                Text("NEON")
                    .font(.system(size: 40, weight: .heavy, design: .rounded))
                    .foregroundStyle(LinearGradient.neonWordmark)
                Text("Admin")
                    .font(.system(size: 18, weight: .medium, design: .rounded))
                    .foregroundStyle(Color.neonInk.opacity(0.55))
            }
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 8)

            VStack(spacing: 14) {
                SecureField("Password", text: $password)
                    .focused($fieldFocused)
                    .padding(.horizontal, 16)
                    .frame(height: 50)
                    .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(fieldFocused ? Color.neonCyanStrong.opacity(0.6) : Color.neonInk.opacity(0.1), lineWidth: fieldFocused ? 1.5 : 1)
                    )
                    .disabled(loading)
                    .submitLabel(.go)
                    .onSubmit { Task { await login() } }
                    .animation(.easeOut(duration: 0.15), value: fieldFocused)

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }

                Button {
                    Task { await login() }
                } label: {
                    ZStack {
                        Text("Sign In")
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
                .disabled(loading || password.isEmpty)
                .opacity(loading || password.isEmpty ? 0.5 : 1)
                .scaleEffect(loading ? 0.98 : 1)
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: loading)
            }
            .padding(.horizontal, 32)
            .opacity(appeared ? 1 : 0)
            .offset(y: appeared ? 0 : 14)

            Spacer()
            Spacer()

            Text("NEON Design & Programming")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.neonInk.opacity(0.3))
                .padding(.bottom, 12)
                .opacity(appeared ? 1 : 0)
        }
        .neonAmbientBackground()
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) { appeared = true }
        }
    }

    private func login() async {
        error = nil
        loading = true
        defer { loading = false }
        do {
            try await api.login(password: password)
            Haptic.success()
        } catch {
            withAnimation { self.error = "Invalid password." }
            Haptic.error()
        }
    }
}

#Preview {
    LoginView().environmentObject(APIClient.shared)
}
