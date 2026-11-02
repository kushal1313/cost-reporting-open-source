"use client";

export interface UsageMetric {
  dimension: string;
  key: string;
  metric: string;
  total: number;
  dailyAverage: number;
  dailyPeak: number;
  effectiveCost: number | null;
}

/**
 * Messages, tokens and active users per product. Active users are a daily
 * count, so they're shown as the daily average and peak — summing them across
 * days would count the same person once per day.
 */
export function ProductUsageTable({ metrics }: { metrics: UsageMetric[] }) {
  const byProduct = new Map<string, Partial<Record<string, UsageMetric>>>();
  for (const m of metrics) {
    if (m.dimension !== "product") continue;
    byProduct.set(m.key, { ...byProduct.get(m.key), [m.metric]: m });
  }
  if (byProduct.size === 0) return null;
  const hasMetric = (metric: string) => [...byProduct.values()].some((p) => p[metric]);
  const fmt = (n: number | undefined) => (n == null ? "—" : Math.round(n).toLocaleString());

  return (
    <table>
      <thead>
        <tr>
          <th>Product</th>
          {hasMetric("messages") && <th>Messages</th>}
          {hasMetric("tokens") && <th>Tokens</th>}
          {hasMetric("active_users") && <th>Active users (daily avg)</th>}
          {hasMetric("active_users") && <th>Active users (daily peak)</th>}
        </tr>
      </thead>
      <tbody>
        {[...byProduct.entries()].map(([product, p]) => (
          <tr key={product}>
            <td>{product}</td>
            {hasMetric("messages") && <td>{fmt(p.messages?.total)}</td>}
            {hasMetric("tokens") && <td>{fmt(p.tokens?.total)}</td>}
            {hasMetric("active_users") && <td>{fmt(p.active_users?.dailyAverage)}</td>}
            {hasMetric("active_users") && <td>{fmt(p.active_users?.dailyPeak)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
