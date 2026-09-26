import { Icon } from "./icons";

// KPI stat card: uppercase sand label, large olive-800 number, optional hint.
// `icon` and `footer` are optional additions; existing callers are unchanged.
export function KpiCard({
  label,
  value,
  hint,
  icon,
  footer,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-sand-200 bg-white p-5 shadow-card">
      {icon && (
        <span
          className="absolute -right-6 -top-6 grid h-20 w-20 place-items-end rounded-full bg-sand-100 p-5 text-sand-500"
          aria-hidden="true"
        >
          <Icon name={icon} className="h-5 w-5" />
        </span>
      )}
      <p className={"eyebrow " + (icon ? "pr-10" : "")}>{label}</p>
      <p className="mt-2 break-words text-3xl font-bold capitalize leading-10 text-olive-800 tabular sm:text-[34px]">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-sand-500">{hint}</p>}
      {footer && <div className="mt-auto pt-4">{footer}</div>}
    </div>
  );
}
