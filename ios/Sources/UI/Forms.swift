import SwiftUI
import UIKit

// MARK: - Field chrome

/// The box every field sits in: white glass, a hairline that turns purple
/// with a soft glow when focused, and red when the field is refused.
struct FieldChrome: ViewModifier {
    var focused = false
    var error = false
    var minHeight: CGFloat = NeonSize.field

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        content
            .padding(.horizontal, 14)
            .frame(minHeight: minHeight)
            .background(shape.fill(Color.white.opacity(focused ? 0.96 : 0.76)))
            .overlay(shape.strokeBorder(borderColor, lineWidth: focused || error ? 1.5 : 1))
            .shadow(color: focused ? (error ? Color.neonDanger : Color.neonPurple).opacity(0.16) : .clear, radius: 10, x: 0, y: 4)
            .animation(NeonMotion.quick, value: focused)
            .animation(NeonMotion.quick, value: error)
    }

    private var borderColor: Color {
        if error { return .neonDanger.opacity(0.7) }
        return focused ? .neonPurple.opacity(0.6) : .neonLine
    }
}

extension View {
    func fieldChrome(focused: Bool = false, error: Bool = false, minHeight: CGFloat = NeonSize.field) -> some View {
        modifier(FieldChrome(focused: focused, error: error, minHeight: minHeight))
    }
}

/// A refusal or a hint under a field.
struct ValidationMessage: View {
    let text: String
    var tone: BadgeTone

    init(_ text: String, tone: BadgeTone = .danger) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Image(systemName: tone == .danger ? "exclamationmark.circle.fill" : "info.circle.fill")
                .font(.system(size: 12, weight: .semibold))
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 13, weight: .medium))
        .foregroundStyle(tone.foreground)
        .transition(.neonRise)
        .accessibilityElement(children: .combine)
    }
}

/// A label above any field, and the hint or the refusal under it. The kit's
/// own fields use it; wrap a custom control in it to match them.
struct FormField<Field: View>: View {
    let label: String
    var isRequired: Bool
    var hint: String?
    var error: String?
    let field: Field

    init(_ label: String, isRequired: Bool = false, hint: String? = nil, error: String? = nil, @ViewBuilder field: () -> Field) {
        self.label = label
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
        self.field = field()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if !label.isEmpty {
                HStack(spacing: 3) {
                    Text(label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.neonTextSecondary)
                    if isRequired {
                        Text(verbatim: "*")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Color.neonPinkStrong)
                            .accessibilityLabel(L("Required"))
                    }
                }
            }
            field
            if let error, !error.isEmpty {
                ValidationMessage(error)
            } else if let hint {
                Text(hint)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.neonTextTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(NeonMotion.snappy, value: error)
    }
}

// MARK: - Text

/// A labelled one-line text field. Pass `focus:` to drive focus from outside
/// (moving to the next field on Return); otherwise it keeps its own.
struct NeonTextField: View {
    let label: String
    @Binding var text: String
    var prompt: String?
    var symbol: String?
    var isRequired: Bool
    var hint: String?
    var error: String?
    var keyboard: UIKeyboardType
    var contentType: UITextContentType?
    var capitalization: TextInputAutocapitalization
    var autocorrect: Bool
    var isSecure: Bool
    var leftToRight: Bool
    var submitLabel: SubmitLabel
    var onSubmit: (() -> Void)?
    var focus: FocusState<Bool>.Binding?

    @FocusState private var ownFocus: Bool
    @State private var revealed = false

    init(
        _ label: String,
        text: Binding<String>,
        prompt: String? = nil,
        symbol: String? = nil,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil,
        keyboard: UIKeyboardType = .default,
        contentType: UITextContentType? = nil,
        capitalization: TextInputAutocapitalization = .sentences,
        autocorrect: Bool = true,
        isSecure: Bool = false,
        leftToRight: Bool = false,
        submitLabel: SubmitLabel = .done,
        onSubmit: (() -> Void)? = nil,
        focus: FocusState<Bool>.Binding? = nil
    ) {
        self.label = label
        self._text = text
        self.prompt = prompt
        self.symbol = symbol
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
        self.keyboard = keyboard
        self.contentType = contentType
        self.capitalization = capitalization
        self.autocorrect = autocorrect
        self.isSecure = isSecure
        self.leftToRight = leftToRight
        self.submitLabel = submitLabel
        self.onSubmit = onSubmit
        self.focus = focus
    }

    private var focusBinding: FocusState<Bool>.Binding { focus ?? $ownFocus }
    private var isFocused: Bool { focusBinding.wrappedValue }

    var body: some View {
        FormField(label, isRequired: isRequired, hint: hint, error: error) {
            HStack(spacing: 10) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(isFocused ? Color.neonPurpleStrong : Color.neonInk.opacity(0.35))
                        .frame(width: 20)
                }
                input
                    .environment(\.layoutDirection, leftToRight ? .leftToRight : AppLanguage.current.layoutDirection)
                if isSecure {
                    Button {
                        Haptic.tap()
                        revealed.toggle()
                        focusBinding.wrappedValue = true
                    } label: {
                        Image(systemName: revealed ? "eye.slash" : "eye")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Color.neonTextTertiary)
                            .frame(width: 28, height: 28)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(revealed ? L("Hide password") : L("Show password"))
                } else if !text.isEmpty && isFocused {
                    Button {
                        text = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(Color.neonTextFaint)
                    }
                    .buttonStyle(.plain)
                    .transition(.neonPop)
                    .accessibilityLabel(L("Clear"))
                }
            }
            .fieldChrome(focused: isFocused, error: error != nil)
            .contentShape(Rectangle())
            .onTapGesture { focusBinding.wrappedValue = true }
        }
    }

    @ViewBuilder
    private var input: some View {
        let placeholder = Text(prompt ?? label).foregroundColor(Color.neonTextFaint)
        Group {
            if isSecure && !revealed {
                SecureField("", text: $text, prompt: placeholder)
            } else {
                TextField("", text: $text, prompt: placeholder)
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(capitalization)
                    .autocorrectionDisabled(!autocorrect)
            }
        }
        .font(.system(size: 16))
        .foregroundStyle(Color.neonInk)
        .textContentType(contentType)
        .focused(focusBinding)
        .submitLabel(submitLabel)
        .onSubmit { onSubmit?() }
    }
}

/// A labelled field for a paragraph: grows from `minLines` to `maxLines`,
/// with a counter when there is a `limit`.
struct NeonTextEditor: View {
    let label: String
    @Binding var text: String
    var prompt: String?
    var minLines: Int
    var maxLines: Int
    var isRequired: Bool
    var hint: String?
    var error: String?
    var limit: Int?
    var focus: FocusState<Bool>.Binding?

    @FocusState private var ownFocus: Bool

    init(
        _ label: String,
        text: Binding<String>,
        prompt: String? = nil,
        minLines: Int = 3,
        maxLines: Int = 8,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil,
        limit: Int? = nil,
        focus: FocusState<Bool>.Binding? = nil
    ) {
        self.label = label
        self._text = text
        self.prompt = prompt
        self.minLines = minLines
        self.maxLines = max(minLines, maxLines)
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
        self.limit = limit
        self.focus = focus
    }

    private var focusBinding: FocusState<Bool>.Binding { focus ?? $ownFocus }

    var body: some View {
        FormField(label, isRequired: isRequired, hint: hint, error: error) {
            VStack(alignment: .trailing, spacing: 4) {
                TextField("", text: $text, prompt: Text(prompt ?? "").foregroundColor(Color.neonTextFaint), axis: .vertical)
                    .font(.system(size: 16))
                    .foregroundStyle(Color.neonInk)
                    .lineLimit(minLines...maxLines)
                    .focused(focusBinding)
                    .padding(.vertical, 13)
                    .fieldChrome(focused: focusBinding.wrappedValue, error: error != nil || isOverLimit, minHeight: 0)
                    .contentShape(Rectangle())
                    .onTapGesture { focusBinding.wrappedValue = true }
                if let limit {
                    Text(verbatim: "\(NeonFormat.integer(text.count)) / \(NeonFormat.integer(limit))")
                        .font(.system(size: 11, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(isOverLimit ? Color.neonDangerStrong : Color.neonTextTertiary)
                }
            }
        }
    }

    private var isOverLimit: Bool {
        guard let limit else { return false }
        return text.count > limit
    }
}

// MARK: - Numbers and money

/// A labelled number field that reads either digit set and keeps a `Double?`
/// (nil when empty). Overloads take `Double`, `Int?` and `Int` bindings.
struct NumberField: View {
    let label: String
    @Binding var value: Double?
    var unit: String?
    var decimals: Int
    var prompt: String?
    var symbol: String?
    var isRequired: Bool
    var hint: String?
    var error: String?

    @State private var draft: String
    @FocusState private var focused: Bool

    init(
        _ label: String,
        value: Binding<Double?>,
        unit: String? = nil,
        decimals: Int = 2,
        prompt: String? = nil,
        symbol: String? = nil,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.label = label
        self._value = value
        self.unit = unit
        self.decimals = decimals
        self.prompt = prompt
        self.symbol = symbol
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
        self._draft = State(initialValue: Self.editable(value.wrappedValue, decimals: decimals))
    }

    init(
        _ label: String,
        value: Binding<Double>,
        unit: String? = nil,
        decimals: Int = 2,
        prompt: String? = nil,
        symbol: String? = nil,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.init(
            label,
            value: Binding<Double?>(get: { value.wrappedValue }, set: { value.wrappedValue = $0 ?? 0 }),
            unit: unit, decimals: decimals, prompt: prompt, symbol: symbol,
            isRequired: isRequired, hint: hint, error: error
        )
    }

    init(
        _ label: String,
        value: Binding<Int?>,
        unit: String? = nil,
        prompt: String? = nil,
        symbol: String? = nil,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.init(
            label,
            value: Binding<Double?>(get: { value.wrappedValue.map(Double.init) }, set: { value.wrappedValue = $0.map { Int($0.rounded()) } }),
            unit: unit, decimals: 0, prompt: prompt, symbol: symbol,
            isRequired: isRequired, hint: hint, error: error
        )
    }

    init(
        _ label: String,
        value: Binding<Int>,
        unit: String? = nil,
        prompt: String? = nil,
        symbol: String? = nil,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.init(
            label,
            value: Binding<Double?>(get: { Double(value.wrappedValue) }, set: { value.wrappedValue = Int(($0 ?? 0).rounded()) }),
            unit: unit, decimals: 0, prompt: prompt, symbol: symbol,
            isRequired: isRequired, hint: hint, error: error
        )
    }

    var body: some View {
        FormField(label, isRequired: isRequired, hint: hint, error: error) {
            HStack(spacing: 10) {
                if let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(focused ? Color.neonPurpleStrong : Color.neonInk.opacity(0.35))
                        .frame(width: 20)
                }
                TextField("", text: $draft, prompt: Text(prompt ?? "0").foregroundColor(Color.neonTextFaint))
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(Color.neonInk)
                    .keyboardType(decimals > 0 ? .decimalPad : .numberPad)
                    .focused($focused)
                    .environment(\.layoutDirection, .leftToRight)
                    .multilineTextAlignment(AppLanguage.current.layoutDirection == .rightToLeft ? .trailing : .leading)
                if let unit {
                    Text(unit)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.neonTextTertiary)
                }
            }
            .fieldChrome(focused: focused, error: error != nil)
            .contentShape(Rectangle())
            .onTapGesture { focused = true }
        }
        .onChange(of: draft) { text in
            let parsed = NeonFormat.parse(text)
            if parsed != value { value = parsed }
        }
        .onChange(of: value) { newValue in
            // Only rewrite the text for changes from outside, not while typing.
            if !focused { draft = Self.editable(newValue, decimals: decimals) }
        }
        .onChange(of: focused) { isFocused in
            if !isFocused { draft = Self.editable(value, decimals: decimals) }
        }
    }

    /// Plain digits for editing: no grouping, as few decimals as needed.
    static func editable(_ value: Double?, decimals: Int) -> String {
        guard let value else { return "" }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? ""
    }
}

/// A money field in Jordanian dinars (or `currency`).
struct MoneyField: View {
    let label: String
    let value: Binding<Double?>
    var currency: String
    var decimals: Int
    var isRequired: Bool
    var hint: String?
    var error: String?

    init(
        _ label: String,
        amount: Binding<Double?>,
        currency: String = "JOD",
        decimals: Int = 2,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.label = label
        self.value = amount
        self.currency = currency
        self.decimals = decimals
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
    }

    init(
        _ label: String,
        amount: Binding<Double>,
        currency: String = "JOD",
        decimals: Int = 2,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.init(
            label,
            amount: Binding<Double?>(get: { amount.wrappedValue }, set: { amount.wrappedValue = $0 ?? 0 }),
            currency: currency, decimals: decimals, isRequired: isRequired, hint: hint, error: error
        )
    }

    var body: some View {
        NumberField(
            label, value: value, unit: L(currency), decimals: decimals,
            prompt: decimals > 0 ? "0.00" : "0", symbol: "banknote",
            isRequired: isRequired, hint: hint, error: error
        )
    }
}

// MARK: - Dates and times

/// A labelled date (or time, or both) with the system's compact picker.
struct DateField: View {
    let label: String
    @Binding var date: Date
    var components: DatePickerComponents
    var range: ClosedRange<Date>?
    var symbol: String?
    var isRequired: Bool
    var hint: String?
    var error: String?

    init(
        _ label: String,
        date: Binding<Date>,
        components: DatePickerComponents = .date,
        in range: ClosedRange<Date>? = nil,
        symbol: String? = nil,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.label = label
        self._date = date
        self.components = components
        self.range = range
        self.symbol = symbol
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
    }

    var body: some View {
        FormField(label, isRequired: isRequired, hint: hint, error: error) {
            HStack(spacing: 10) {
                Image(systemName: symbol ?? (components == .hourAndMinute ? "clock" : "calendar"))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.neonPurpleStrong.opacity(0.8))
                    .frame(width: 20)
                picker
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .tint(.neonPurpleStrong)
                    .fixedSize()
                Spacer(minLength: 0)
            }
            .fieldChrome(error: error != nil)
        }
    }

    @ViewBuilder
    private var picker: some View {
        if let range {
            DatePicker(label, selection: $date, in: range, displayedComponents: components)
        } else {
            DatePicker(label, selection: $date, displayedComponents: components)
        }
    }
}

/// A labelled time of day.
struct TimeField: View {
    let label: String
    let time: Binding<Date>
    var isRequired: Bool
    var hint: String?
    var error: String?

    init(_ label: String, time: Binding<Date>, isRequired: Bool = false, hint: String? = nil, error: String? = nil) {
        self.label = label
        self.time = time
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
    }

    var body: some View {
        DateField(label, date: time, components: .hourAndMinute, symbol: "clock", isRequired: isRequired, hint: hint, error: error)
    }
}

/// A date that may be left out: "Add a date" until one is chosen, and a way
/// to take it off again.
struct OptionalDateField: View {
    let label: String
    @Binding var date: Date?
    var components: DatePickerComponents
    var suggested: () -> Date
    var addTitle: String
    var hint: String?
    var error: String?

    init(
        _ label: String,
        date: Binding<Date?>,
        components: DatePickerComponents = .date,
        suggested: @escaping () -> Date = { Date() },
        addTitle: String = L("Add a date"),
        hint: String? = nil,
        error: String? = nil
    ) {
        self.label = label
        self._date = date
        self.components = components
        self.suggested = suggested
        self.addTitle = addTitle
        self.hint = hint
        self.error = error
    }

    var body: some View {
        FormField(label, hint: hint, error: error) {
            HStack(spacing: 10) {
                Image(systemName: components == .hourAndMinute ? "clock" : "calendar")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color.neonPurpleStrong.opacity(date == nil ? 0.45 : 0.8))
                    .frame(width: 20)
                if let current = date {
                    DatePicker(
                        label,
                        selection: Binding(get: { date ?? current }, set: { date = $0 }),
                        displayedComponents: components
                    )
                    .labelsHidden()
                    .datePickerStyle(.compact)
                    .tint(.neonPurpleStrong)
                    .fixedSize()
                    .transition(.neonPop)
                    Spacer(minLength: 0)
                    Button {
                        Haptic.tap()
                        withNeonAnimation { date = nil }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(Color.neonTextFaint)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L("Remove date"))
                } else {
                    Button {
                        Haptic.tap()
                        withNeonAnimation { date = suggested() }
                    } label: {
                        Text(addTitle)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.neonPurpleStrong)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .fieldChrome(error: error != nil)
        }
    }
}

// MARK: - Choosing

/// A labelled menu of a few options (up to a dozen or so). For long lists,
/// or several at once, use `SelectField`.
struct MenuField<Option: Hashable>: View {
    let label: String
    @Binding var selection: Option?
    let options: [Option]
    let title: (Option) -> String
    var symbol: ((Option) -> String?)?
    var placeholder: String
    var noneTitle: String?
    var leadingSymbol: String?
    var isRequired: Bool
    var hint: String?
    var error: String?

    init(
        _ label: String,
        selection: Binding<Option?>,
        options: [Option],
        title: @escaping (Option) -> String,
        symbol: ((Option) -> String?)? = nil,
        placeholder: String = L("Choose…"),
        noneTitle: String? = nil,
        leadingSymbol: String? = nil,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.label = label
        self._selection = selection
        self.options = options
        self.title = title
        self.symbol = symbol
        self.placeholder = placeholder
        self.noneTitle = noneTitle
        self.leadingSymbol = leadingSymbol
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
    }

    init(
        _ label: String,
        selection: Binding<Option>,
        options: [Option],
        title: @escaping (Option) -> String,
        symbol: ((Option) -> String?)? = nil,
        leadingSymbol: String? = nil,
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.init(
            label,
            selection: Binding<Option?>(get: { selection.wrappedValue }, set: { if let value = $0 { selection.wrappedValue = value } }),
            options: options, title: title, symbol: symbol, leadingSymbol: leadingSymbol,
            isRequired: isRequired, hint: hint, error: error
        )
    }

    var body: some View {
        FormField(label, isRequired: isRequired, hint: hint, error: error) {
            Menu {
                if let noneTitle {
                    Button {
                        Haptic.selection()
                        selection = nil
                    } label: {
                        if selection == nil {
                            Label(noneTitle, systemImage: "checkmark")
                        } else {
                            Text(noneTitle)
                        }
                    }
                    Divider()
                }
                ForEach(options, id: \.self) { option in
                    Button {
                        Haptic.selection()
                        selection = option
                    } label: {
                        if option == selection {
                            Label(title(option), systemImage: "checkmark")
                        } else if let name = symbol?(option) {
                            Label(title(option), systemImage: name)
                        } else {
                            Text(title(option))
                        }
                    }
                }
            } label: {
                HStack(spacing: 10) {
                    if let leadingSymbol {
                        Image(systemName: leadingSymbol)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Color.neonInk.opacity(0.35))
                            .frame(width: 20)
                    } else if let selection, let name = symbol?(selection) {
                        Image(systemName: name)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Color.neonPurpleStrong)
                            .frame(width: 20)
                    }
                    Text(selection.map(title) ?? placeholder)
                        .font(.system(size: 16))
                        .foregroundStyle(selection == nil ? Color.neonTextFaint : Color.neonInk)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.neonTextTertiary)
                }
                .fieldChrome(error: error != nil)
                .contentShape(Rectangle())
            }
        }
    }
}

/// A labelled field that opens a searchable sheet — for long lists (projects,
/// people) and for choosing several at once. Chosen people show as chips.
struct SelectField<Option: Hashable>: View {
    let label: String
    @Binding var selection: Set<Option>
    let options: [Option]
    let title: (Option) -> String
    var subtitle: ((Option) -> String?)?
    var avatar: ((Option) -> URL?)?
    var allowsMultiple: Bool
    var placeholder: String
    var isRequired: Bool
    var hint: String?
    var error: String?

    @State private var picking = false

    /// Several at once.
    init(
        _ label: String,
        selection: Binding<Set<Option>>,
        options: [Option],
        title: @escaping (Option) -> String,
        subtitle: ((Option) -> String?)? = nil,
        avatar: ((Option) -> URL?)? = nil,
        placeholder: String = L("Choose…"),
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.label = label
        self._selection = selection
        self.options = options
        self.title = title
        self.subtitle = subtitle
        self.avatar = avatar
        self.allowsMultiple = true
        self.placeholder = placeholder
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
    }

    /// Exactly one (or none).
    init(
        _ label: String,
        selection: Binding<Option?>,
        options: [Option],
        title: @escaping (Option) -> String,
        subtitle: ((Option) -> String?)? = nil,
        avatar: ((Option) -> URL?)? = nil,
        placeholder: String = L("Choose…"),
        isRequired: Bool = false,
        hint: String? = nil,
        error: String? = nil
    ) {
        self.label = label
        self._selection = Binding<Set<Option>>(
            get: { selection.wrappedValue.map { [$0] } ?? [] },
            set: { selection.wrappedValue = $0.first }
        )
        self.options = options
        self.title = title
        self.subtitle = subtitle
        self.avatar = avatar
        self.allowsMultiple = false
        self.placeholder = placeholder
        self.isRequired = isRequired
        self.hint = hint
        self.error = error
    }

    private var chosen: [Option] { options.filter { selection.contains($0) } }

    var body: some View {
        FormField(label, isRequired: isRequired, hint: hint, error: error) {
            Button {
                Haptic.tap()
                picking = true
            } label: {
                HStack(spacing: 10) {
                    if chosen.isEmpty {
                        Text(placeholder)
                            .font(.system(size: 16))
                            .foregroundStyle(Color.neonTextFaint)
                    } else if avatar != nil {
                        FlowRow(spacing: 6) {
                            ForEach(chosen, id: \.self) { option in
                                PersonChip(name: title(option), url: avatar?(option))
                            }
                        }
                        .padding(.vertical, 8)
                    } else {
                        Text(chosen.map(title).joined(separator: "، "))
                            .font(.system(size: 16))
                            .foregroundStyle(Color.neonInk)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.forward")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.neonTextTertiary)
                }
                .fieldChrome(error: error != nil)
                .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.99))
        }
        .sheet(isPresented: $picking) {
            SelectSheet(
                title: label, selection: $selection, options: options, allowsMultiple: allowsMultiple,
                optionTitle: title, subtitle: subtitle, avatar: avatar
            )
            .neonSheet([.medium, .large])
        }
    }
}

/// The sheet behind `SelectField`: search on top, a checkmark list, Done.
struct SelectSheet<Option: Hashable>: View {
    let title: String
    @Binding var selection: Set<Option>
    let options: [Option]
    var allowsMultiple: Bool
    let optionTitle: (Option) -> String
    var subtitle: ((Option) -> String?)?
    var avatar: ((Option) -> URL?)?

    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    private var visible: [Option] {
        options.filter { matchesSearch(query, optionTitle($0), subtitle?($0)) }
    }

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title, subtitle: allowsMultiple && !selection.isEmpty ? L("%@ chosen", NeonFormat.integer(selection.count)) : nil) {
                dismiss()
            }
            if options.count > 7 {
                SearchField(text: $query)
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.bottom, 10)
            }
            ScrollView {
                LazyVStack(spacing: 6) {
                    if visible.isEmpty {
                        EmptyState(symbol: "magnifyingglass", title: L("Nothing matches “%@”", query))
                    }
                    ForEach(visible, id: \.self) { option in
                        let isOn = selection.contains(option)
                        Button {
                            Haptic.selection()
                            toggle(option)
                        } label: {
                            ListRow(
                                optionTitle(option),
                                subtitle: subtitle?(option),
                                leading: avatar.map { RowLeading.avatar(url: $0(option), name: optionTitle(option)) } ?? RowLeading.plain
                            ) {
                                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 22))
                                    .foregroundStyle(isOn ? Color.neonPurpleStrong : Color.neonTextFaint)
                                    .animation(NeonMotion.snappy, value: isOn)
                            }
                            .background(
                                RoundedRectangle(cornerRadius: 16, style: .continuous)
                                    .fill(isOn ? Color.neonPurple.opacity(0.08) : Color.white.opacity(0.6))
                            )
                        }
                        .buttonStyle(.pressableCard)
                    }
                }
                .padding(.horizontal, NeonSpace.gutter)
                .padding(.bottom, 90)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .safeAreaInset(edge: .bottom) {
            if allowsMultiple {
                NeonButton(L("Confirm"), kind: .primary) { dismiss() }
                    .padding(.horizontal, NeonSpace.gutter)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial)
            }
        }
        .background(Color.neonBg.ignoresSafeArea())
    }

    private func toggle(_ option: Option) {
        if allowsMultiple {
            if selection.contains(option) {
                selection.remove(option)
            } else {
                selection.insert(option)
            }
        } else {
            selection = [option]
            dismiss()
        }
    }
}

// MARK: - Switches and groups

/// A setting that is on or off, with what it means under it.
struct ToggleRow: View {
    let title: String
    var detail: String?
    var symbol: String?
    var tint: Color
    @Binding var isOn: Bool

    init(_ title: String, detail: String? = nil, symbol: String? = nil, tint: Color = .neonPurpleStrong, isOn: Binding<Bool>) {
        self.title = title
        self.detail = detail
        self.symbol = symbol
        self.tint = tint
        self._isOn = isOn
    }

    var body: some View {
        Toggle(isOn: $isOn) {
            HStack(spacing: 12) {
                if let symbol {
                    IconTile(symbol, tint: tint, size: 32)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.neonInk)
                    if let detail {
                        Text(detail)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.neonTextTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .tint(.neonPurple)
        .padding(.vertical, 4)
        .onChange(of: isOn) { _ in Haptic.selection() }
    }
}

/// A titled group of fields on one glass card.
struct FormSection<Content: View>: View {
    var title: String?
    var footer: String?
    let content: Content

    init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                SectionLabel(title)
                    .padding(.horizontal, 4)
            }
            VStack(alignment: .leading, spacing: 16) {
                content
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .neonSurface(.glass, radius: NeonRadius.lg)
            if let footer {
                Text(footer)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.neonTextTertiary)
                    .padding(.horizontal, 4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
