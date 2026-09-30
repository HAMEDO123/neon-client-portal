import SwiftUI

/// The employee's account details — mirrors the "Details" form on
/// `employees/[id]/page.tsx`: name, contact, sales target, the three
/// permission ticks, and what a day plan is built from.
struct EditEmployeeSheet: View {
    let employeeId: String
    let employee: TeamEmployeeDetail
    let colleagues: [TeamColleague]
    var onSaved: () async -> Void

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var email: String
    @State private var role: String
    @State private var phone: String
    @State private var employeeCode: String
    @State private var monthlySalesTarget: Int
    @State private var canReadWhatsApp: Bool
    @State private var canAssignTasks: Bool
    @State private var canLogSiteVisits: Bool
    @State private var playbook: String
    @State private var skills: String
    @State private var examples: String
    @State private var dailyCapacityMinutes: Int?
    @State private var reviewerId: String?

    init(employeeId: String, employee: TeamEmployeeDetail, colleagues: [TeamColleague], onSaved: @escaping () async -> Void) {
        self.employeeId = employeeId
        self.employee = employee
        self.colleagues = colleagues
        self.onSaved = onSaved
        _name = State(initialValue: employee.name)
        _email = State(initialValue: employee.email ?? "")
        _role = State(initialValue: employee.role ?? "")
        _phone = State(initialValue: employee.phone ?? "")
        _employeeCode = State(initialValue: employee.employeeCode ?? "")
        _monthlySalesTarget = State(initialValue: employee.monthlySalesTarget)
        _canReadWhatsApp = State(initialValue: employee.canReadWhatsApp)
        _canAssignTasks = State(initialValue: employee.canAssignTasks)
        _canLogSiteVisits = State(initialValue: employee.canLogSiteVisits)
        _playbook = State(initialValue: employee.playbook ?? "")
        _skills = State(initialValue: employee.skills ?? "")
        _examples = State(initialValue: employee.examples ?? "")
        _dailyCapacityMinutes = State(initialValue: employee.dailyCapacityMinutes)
        _reviewerId = State(initialValue: employee.reviewerId)
    }

    var body: some View {
        SheetScaffold(
            L("Edit details"),
            subtitle: employee.name,
            symbol: "person.text.rectangle",
            primaryTitle: L("Save details"),
            isPrimaryEnabled: !name.trimmingCharacters(in: .whitespaces).isEmpty
        ) {
            await save()
        } content: {
            FormSection(L("Details")) {
                NeonTextField(L("Full name"), text: $name, symbol: "person", isRequired: true)
                NeonTextField(L("Email"), text: $email, symbol: "envelope", keyboard: .emailAddress, capitalization: .never, autocorrect: false, leftToRight: true)
                NeonTextField(L("Job title"), text: $role, symbol: "briefcase")
                NeonTextField(L("Phone"), text: $phone, prompt: L("+962 7 0000 0000"), symbol: "phone", keyboard: .phonePad, leftToRight: true)
                NeonTextField(L("Employee ID"), text: $employeeCode, symbol: "number", leftToRight: true)
                NumberField(L("Monthly sales target"), value: $monthlySalesTarget, unit: L("projects"), symbol: "target")
            }

            FormSection(L("Permissions"), footer: L("Off for everyone until you tick it.")) {
                ToggleRow(L("Can use the company WhatsApp"), detail: L("Read the studio's conversations and reply as the studio."), symbol: "message.fill", isOn: $canReadWhatsApp)
                ToggleRow(L("Can hand out tasks"), detail: L("Choose who a job is for and which days it runs over."), symbol: "person.2.badge.gearshape.fill", isOn: $canAssignTasks)
                ToggleRow(L("Keeps the site-visit diary"), detail: L("Schedule a visit, then say what came of it."), symbol: "mappin.and.ellipse", isOn: $canLogSiteVisits)
            }

            FormSection(L("Day planning"), footer: L("All optional: left empty, nothing about this person is invented.")) {
                NeonTextEditor(L("What they usually do"), text: $playbook, minLines: 3, maxLines: 6, limit: 4000)
                NeonTextEditor(L("What they can do"), text: $skills, minLines: 2, maxLines: 4, limit: 2000)
                NeonTextEditor(L("Work of theirs worth copying"), text: $examples, minLines: 2, maxLines: 4, limit: 2000)
                NumberField(L("Minutes of real work in their day"), value: $dailyCapacityMinutes, unit: L("min"))
                MenuField(
                    L("Their work is reviewed by"),
                    selection: $reviewerId,
                    options: colleagues.map(\.id),
                    title: { id in colleagues.first(where: { $0.id == id })?.name ?? id },
                    noneTitle: L("The manager")
                )
            }
        }
        .neonSheet([.large])
    }

    private func save() async {
        // The server reads these three like HTML checkboxes: present means
        // ticked, absent means cleared (`formData.get(...) !== null`) — so an
        // unticked box must be left out of the form entirely, not sent empty.
        var form: [String: Any] = [
            "name": name,
            "email": email,
            "role": role,
            "phone": phone,
            "employeeCode": employeeCode,
            "monthlySalesTarget": String(monthlySalesTarget),
            "playbook": playbook,
            "skills": skills,
            "examples": examples,
            "dailyCapacityMinutes": dailyCapacityMinutes.map(String.init) ?? "",
            "reviewerId": reviewerId ?? "",
        ]
        if canReadWhatsApp { form["canReadWhatsApp"] = "on" }
        if canAssignTasks { form["canAssignTasks"] = "on" }
        if canLogSiteVisits { form["canLogSiteVisits"] = "on" }

        do {
            try await api.perform("team/updateEmployee", args: [employeeId], form: form)
            Haptic.success()
            Toast.success(L("Saved"))
            dismiss()
            await onSaved()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}

/// Sets a new password for the account — the employee is told in-app; existing
/// sessions stay valid until they expire, exactly as the web form says.
struct ResetPasswordSheet: View {
    let employeeId: String

    @EnvironmentObject var api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""

    var body: some View {
        SheetScaffold(
            L("Set a new password"),
            subtitle: L("The employee is notified in-app. Existing sessions stay valid until they expire."),
            symbol: "key.fill",
            primaryTitle: L("Update password"),
            isPrimaryEnabled: password.count >= 8
        ) {
            await save()
        } content: {
            FormSection {
                NeonTextField(
                    L("New password"), text: $password, prompt: L("At least 8 characters"), symbol: "lock",
                    error: (1...7).contains(password.count) ? L("At least 8 characters") : nil,
                    isSecure: true, leftToRight: true
                )
            }
        }
        .neonSheet([.medium])
    }

    private func save() async {
        do {
            try await api.perform("team/resetPassword", args: [employeeId], form: ["password": password])
            Haptic.success()
            Toast.success(L("Password updated"))
            dismiss()
        } catch {
            Haptic.error()
            Toast.error(error)
        }
    }
}
