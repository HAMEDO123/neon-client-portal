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
            subtitle: L("Start with the essentials — renders, drawings, BOQ and pricing come right after."),
            symbol: "folder.badge.plus",
            primaryTitle: L("Create Project"),
            isPrimaryEnabled: isValid
        ) {
            await save()
        } content: {
            FormSection(L("Project")) {
                NeonTextField(L("Project Name"), text: $name, symbol: "textformat", isRequired: true)
                NeonTextField(L("Client Name"), text: $clientName, symbol: "person")
                NeonTextField(L("Client Email"), text: $clientEmail, keyboard: .emailAddress, capitalization: .never, leftToRight: true)
                NeonTextField(L("Client Phone"), text: $clientPhone, keyboard: .phonePad, leftToRight: true)
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
