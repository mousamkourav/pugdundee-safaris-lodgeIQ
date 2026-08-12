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
  return (
    <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-sand-100 text-left text-sand-600">
            {columns.map((c) => (
              <th
                key={c.key}
                className={"px-4 py-2.5 font-medium " + (c.className ?? "")}
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
                className="border-t border-sand-200 hover:bg-sand-50"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={"px-4 py-2.5 " + (c.className ?? "")}
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
