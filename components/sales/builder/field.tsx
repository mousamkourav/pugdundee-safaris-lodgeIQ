import { ui } from "@/components/ui";

export function Field({
  label,
  required,
  children,
  hint,
  error,
  wide,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
  error?: string | null;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className={ui.label}>
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs font-medium text-error">{error}</p> : hint ? <p className="mt-1 text-xs text-sand-500">{hint}</p> : null}
    </div>
  );
}
