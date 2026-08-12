export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4">
      <p className="text-sm text-sand-600">{label}</p>
      <p className="mt-1 text-2xl capitalize text-olive-700 tabular">{value}</p>
      {hint && <p className="mt-1 text-xs text-sand-500">{hint}</p>}
    </div>
  );
}
