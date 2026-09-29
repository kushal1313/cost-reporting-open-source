"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface CostBreakdownRow {
  group: string;
  effectiveCost: number;
  billedCost: number;
}

export function CostBreakdownChart({ data }: { data: CostBreakdownRow[] }) {
  if (data.length === 0) return <p>No cost data yet — sync a connector first.</p>;

  const height = Math.max(280, data.length * 32);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
        <defs>
          <linearGradient id="costBarGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffab4c" />
            <stop offset="100%" stopColor="#ff3d00" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#34261c" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => `$${v}`} stroke="#a4907d" />
        <YAxis type="category" dataKey="group" width={160} stroke="#a4907d" />
        <Tooltip
          formatter={(value) => `$${Number(value).toFixed(2)}`}
          contentStyle={{ background: "#1f1712", border: "1px solid #34261c", borderRadius: 8 }}
          labelStyle={{ color: "#f5ece1" }}
          cursor={{ fill: "rgba(255, 106, 0, 0.06)" }}
        />
        <Bar dataKey="effectiveCost" fill="url(#costBarGradient)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
