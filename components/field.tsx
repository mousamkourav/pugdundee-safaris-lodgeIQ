export function Field({
  name,
  label,
  type = "text",
  required = false,
  defaultValue,
  disabled = false,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string | number;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-sand-500">
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        disabled={disabled}
        className="w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm text-sand-700 outline-none transition focus:border-olive-600 focus:ring-3 focus:ring-gold-500/35 disabled:bg-sand-100 disabled:text-sand-500"
      />
    </div>
  );
}
