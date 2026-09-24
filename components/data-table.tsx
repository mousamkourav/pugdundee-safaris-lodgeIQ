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
    i === 0 ? `sticky left-0 z-10 ${base}` : "";

  return (
    <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-sand-100 text-left text-sand-600">
            {columns.map((c, i) => (
              <th
                key={c.key}
                className={
                  "whitespace-nowrap px-4 py-2.5 font-medium " +
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
                className="group border-t border-sand-200 hover:bg-sand-50"
              >
                {columns.map((c, ci) => (
                  <td
                    key={c.key}
                    className={
                      "whitespace-nowrap px-4 py-2.5 " +
                      stick(
                        ci,
                        "bg-white font-medium group-hover:bg-sand-50"
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
