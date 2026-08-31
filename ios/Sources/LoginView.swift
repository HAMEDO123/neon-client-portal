import SwiftUI

struct LoginView: View {
    @EnvironmentObject var api: APIClient
    @State private var password = ""
    @State private var error: String?
    @State private var loading = false

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            VStack(spacing: 4) {
                Text("NEON")
                    .font(.system(size: 34, weight: .heavy))
                    .foregroundStyle(
                        LinearGradient(colors: [.purple, .pink], startPoint: .leading, endPoint: .trailing)
                    )
                Text("Admin")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }

            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 32)
                .disabled(loading)
                .submitLabel(.go)
                .onSubmit { Task { await login() } }

            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }

            Button {
                Task { await login() }
            } label: {
                Group {
                    if loading {
                        ProgressView().tint(.white)
                    } else {
                        Text("Sign In")
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.black)
            .padding(.horizontal, 32)
            .disabled(loading || password.isEmpty)

            Spacer()
            Spacer()
        }
    }

    private func login() async {
        error = nil
        loading = true
        defer { loading = false }
        do {
            try await api.login(password: password)
        } catch {
            self.error = "Invalid password."
        }
    }
}

#Preview {
    LoginView().environmentObject(APIClient.shared)
}
