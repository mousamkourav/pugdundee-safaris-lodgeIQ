export const inp =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-gold-500";
export const btn =
  "w-full rounded-lg bg-olive-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-olive-700";

export function L({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-sand-600">{label}</span>
      {children}
    </label>
  );
}

export function labelize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function DeleteBtn({
  action,
  id,
  lodge,
  month,
}: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  lodge: string;
  month: string;
}) {
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="lodge_id" value={lodge} />
      <input type="hidden" name="month" value={month} />
      <button className="text-xs text-error hover:underline">Delete</button>
    </form>
  );
}
