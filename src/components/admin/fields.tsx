import { cn } from "@/lib/utils";

const inputClass =
  "w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-cyan-strong";

export function TextInput({
  label,
  name,
  defaultValue,
  type = "text",
  placeholder,
  required = true,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  type?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-ink/50">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className={inputClass}
      />
    </div>
  );
}

export function TextArea({
  label,
  name,
  defaultValue,
  rows = 3,
  required = false,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  rows?: number;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-ink/50">{label}</label>
      <textarea name={name} defaultValue={defaultValue} rows={rows} required={required} className={inputClass} />
    </div>
  );
}

export function Select({
  label,
  name,
  defaultValue,
  options,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-ink/50">{label}</label>
      <select name={name} defaultValue={defaultValue} className={cn(inputClass, "appearance-none")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Checkbox({
  label,
  name,
  defaultChecked,
  description,
  className,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
  description?: string;
  className?: string;
}) {
  return (
    <label className={cn("flex items-start gap-3 rounded-lg border border-ink/10 bg-white/50 p-3", className)}>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 h-4 w-4 accent-[var(--cyan-strong)]"
      />
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink/45">{description}</span>}
      </span>
    </label>
  );
}

export function FileInput({
  label,
  name,
  accept,
  className,
}: {
  label: string;
  name: string;
  accept: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium text-ink/50">{label}</label>
      <input
        type="file"
        name={name}
        accept={accept}
        className="block w-full text-xs text-ink/60 file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-bg"
      />
    </div>
  );
}
