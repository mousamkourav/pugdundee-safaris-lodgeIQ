export interface Column {
  key: string;
  label: string;
  className?: string;
}

export function DataTable({
  columns,
  rows,
  empty = "No records yet.",
}: {
  columns: Column[];
  rows: Array<Record<string, React.ReactNode>>;
  empty?: string;
}) {
  // The first column (lodge or month) stays pinned while the rest scrolls, so a
  // wide comparison table is still readable on a phone or tablet.
  const stick = (i: number, base: string) =>
    i === 0 ? `sticky left-0 z-10 shadow-sticky-col ${base}` : "";

  return (
    <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white shadow-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="h-11 border-b border-sand-200 bg-sand-100 text-left">
            {columns.map((c, i) => (
              <th
                key={c.key}
                className={
                  "whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-sand-600 " +
                  stick(i, "bg-sand-100") +
                  " " +
                  (c.className ?? "")
                }
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-sand-500"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr
                key={i}
                className="group h-12 border-t border-sand-100 transition-colors first:border-t-0 hover:bg-sand-50"
              >
                {columns.map((c, ci) => (
                  <td
                    key={c.key}
                    className={
                      "whitespace-nowrap px-4 py-3 text-sand-700 " +
                      stick(
                        ci,
                        "bg-white font-semibold text-olive-800 group-hover:bg-sand-50"
                      ) +
                      " " +
                      (c.className ?? "")
                    }
                  >
                    {r[c.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
