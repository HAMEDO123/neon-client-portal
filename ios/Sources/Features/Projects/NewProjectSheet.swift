import SwiftUI

/// Starting a project — the manager only (createProject is requireAdmin on
/// the server); the list hides the button for the team, and this sheet is
/// reachable only from there.
struct NewProjectSheet: View {
    let onCreated: (String?) -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var clientName = ""
    @State private var clientEmail = ""
    @State private var clientPhone = ""
    @State private var location = ""
    @State private var area = ""
    @State private var projectType = ""
    @State private var description = ""
    @State private var deliveryDate: Date?
    @State private var attempts = 0

    private var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        SheetScaffold(
            L("New Project"),
            subtitle: L("Renders, drawings and pricing come next"),
            symbol: "folder.badge.plus",
            primaryTitle: L("Create Project"),
            isPrimaryEnabled: isValid
        ) {
            await save()
        } content: {
            FormSection(L("Project"), footer: L("Only the name is needed now; everything else can be filled in later from the project's page.")) {
                NeonTextField(L("Project Name"), text: $name, prompt: L("Villa, café, office…"), symbol: "textformat", isRequired: true)
                NeonTextField(L("Client Name"), text: $clientName, symbol: "person")
                NeonTextField(L("Client Email"), text: $clientEmail, symbol: "envelope", keyboard: .emailAddress, contentType: .emailAddress, capitalization: .never, autocorrect: false, leftToRight: true)
                NeonTextField(L("Client Phone"), text: $clientPhone, symbol: "phone", keyboard: .phonePad, contentType: .telephoneNumber, leftToRight: true)
                OptionalDateField(L("Delivery Date"), date: $deliveryDate)
            }
            FormSection(L("Details")) {
                NeonTextField(L("Location"), text: $location, symbol: "mappin.and.ellipse")
                NeonTextField(L("Area"), text: $area, symbol: "ruler")
                NeonTextField(L("Project Type"), text: $projectType, symbol: "tag")
                NeonTextEditor(L("Description"), text: $description, minLines: 3, maxLines: 8, limit: 600)
            }
        }
        .neonSheet([.large])
        .shake(attempts)
    }

    private func save() async {
        var fields: [String: String] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "clientName": clientName,
            "clientEmail": clientEmail,
            "clientPhone": clientPhone,
            "location": location,
            "area": area,
            "projectType": projectType,
            "description": description,
        ]
        if let deliveryDate { fields["deliveryDate"] = NeonFormat.dayKey(deliveryDate) }
        do {
            let redirect = try await api.createProject(fields: fields)
            Haptic.success()
            Toast.success(L("Project created"))
            dismiss()
            onCreated(redirect?.split(separator: "/").last.map(String.init))
        } catch {
            attempts += 1
            Haptic.error()
            Toast.error(error)
        }
    }
}
