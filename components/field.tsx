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
      <label className="mb-1 block text-sm text-sand-700">
        {label}
        {required && " *"}
      </label>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        disabled={disabled}
        className="w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500 disabled:bg-sand-100 disabled:text-sand-500"
      />
    </div>
  );
}
