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

// Series palette from the design tokens: olive, gold, then lighter/darker
// steps so neighbouring series stay distinguishable.
const COLORS = ["#5A6B2F", "#C9A227", "#8FA152", "#3A4519", "#E9CB55", "#B09F7C"];
const GRID = "#F2EDE1"; // sand-100
const AXIS = { fontSize: 11, fill: "#8A7A56" }; // sand-500
const TOOLTIP = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #E6DDCA",
    boxShadow: "0 4px 6px -1px rgba(79,69,49,0.08), 0 10px 24px -3px rgba(79,69,49,0.06)",
    fontSize: 12,
  },
  cursor: { fill: "rgba(90,107,47,0.06)" },
};

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-sand-200 bg-white p-5 shadow-card">
      <div className="mb-4">
        <h3 className="text-base leading-6">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-sand-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function BarCompare({
  title,
  data,
}: {
  title: string;
  data: { name: string; value: number }[];
}) {
  return (
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip {...TOOLTIP} />
          <Bar dataKey="value" fill={COLORS[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
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
    <ChartCard title={title}>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP.contentStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
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
    </ChartCard>
  );
}

export function DonutShare({
  title,
  subtitle,
  data,
}: {
  title: string;
  subtitle?: string;
  data: { name: string; value: number }[];
}) {
  const total = data.reduce((t, d) => t + (d.value || 0), 0);
  const fmt = (n: number) =>
    "\u20B9" + Math.round(n).toLocaleString("en-IN");
  const hasData = total > 0;
  // Colour by original position so the legend (sorted) matches the slices.
  const colorOf = new Map(data.map((d, i) => [d.name, COLORS[i % COLORS.length]]));
  return (
    <ChartCard title={title} subtitle={subtitle}>
      {!hasData ? (
        <div className="grid h-[240px] place-items-center text-sm text-sand-400">
          No data for this range.
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 lg:flex-row">
          <div className="relative w-full">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={68}
                  outerRadius={100}
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((d) => (
                    <Cell key={d.name} fill={colorOf.get(d.name)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={TOOLTIP.contentStyle}
                  formatter={(value, name) => {
                    const v = Number(value) || 0;
                    const pct = total ? Math.round((v / total) * 100) : 0;
                    return [`${fmt(v)} (${pct}%)`, String(name)];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <p className="font-display text-xl font-bold text-olive-800 tabular">
                  {fmt(total)}
                </p>
                <p className="text-[11px] uppercase tracking-wider text-sand-500">Total</p>
              </div>
            </div>
          </div>
          <ul className="w-full shrink-0 space-y-2 lg:w-60">
            {[...data]
              .sort((a, b) => b.value - a.value)
              .map((d) => {
                const pct = total ? Math.round((d.value / total) * 100) : 0;
                return (
                  <li
                    key={d.name}
                    className="flex items-center justify-between gap-2 border-b border-sand-100 pb-2 text-sm last:border-0"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: colorOf.get(d.name) }}
                      />
                      <span className="truncate text-sand-700">{d.name}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular text-sand-600">{pct}%</span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}
