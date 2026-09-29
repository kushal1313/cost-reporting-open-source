"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendPoint {
  date: string;
  effectiveCost: number;
}

export function CostTrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length === 0) return <p>No cost data yet — sync a connector first.</p>;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="costTrendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff8c1a" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#ff8c1a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#34261c" />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          stroke="#a4907d"
        />
        <YAxis tickFormatter={(v) => `$${v}`} stroke="#a4907d" />
        <Tooltip
          formatter={(value) => `$${Number(value).toFixed(2)}`}
          labelFormatter={(v) => new Date(v).toLocaleDateString()}
          contentStyle={{ background: "#1f1712", border: "1px solid #34261c", borderRadius: 8 }}
          labelStyle={{ color: "#f5ece1" }}
        />
        <Area
          type="monotone"
          dataKey="effectiveCost"
          stroke="#ff6a00"
          strokeWidth={2.5}
          fill="url(#costTrendGradient)"
          dot={false}
          activeDot={{ r: 4, fill: "#ff6a00", stroke: "#1f1712", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
