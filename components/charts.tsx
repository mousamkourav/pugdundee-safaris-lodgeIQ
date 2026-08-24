"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#907A17", "#DAB705", "#6B8E23", "#B5651D", "#2E7D6F", "#8D6E63"];

export function BarCompare({
  title,
  data,
}: {
  title: string;
  data: { name: string; value: number }[];
}) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-medium text-sand-700">{title}</h3>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EFE9D8" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" fill="#907A17" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineTrend({
  title,
  data,
  series,
}: {
  title: string;
  data: Record<string, string | number>[];
  series: string[];
}) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-medium text-sand-700">{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#EFE9D8" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Line
              key={s}
              type="monotone"
              dataKey={s}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DonutShare({
  title,
  subtitle,
  data,
  formatValue,
}: {
  title: string;
  subtitle?: string;
  data: { name: string; value: number }[];
  formatValue?: (n: number) => string;
}) {
  const total = data.reduce((t, d) => t + (d.value || 0), 0);
  const fmt = formatValue ?? ((n: number) => String(Math.round(n)));
  const hasData = total > 0;
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-4">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-sand-700">{title}</h3>
        {subtitle && <p className="text-xs text-sand-400">{subtitle}</p>}
      </div>
      {!hasData ? (
        <div className="grid h-[240px] place-items-center text-sm text-sand-400">
          No data for this range.
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={62}
                outerRadius={95}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => {
                  const v = Number(value) || 0;
                  const pct = total ? Math.round((v / total) * 100) : 0;
                  return [`${fmt(v)} (${pct}%)`, String(name)];
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <ul className="w-full shrink-0 space-y-1.5 sm:w-56">
            {[...data]
              .sort((a, b) => b.value - a.value)
              .map((d, i) => {
                const pct = total ? Math.round((d.value / total) * 100) : 0;
                return (
                  <li
                    key={d.name}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span className="truncate text-sand-700">{d.name}</span>
                    </span>
                    <span className="shrink-0 tabular text-sand-500">{pct}%</span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}

