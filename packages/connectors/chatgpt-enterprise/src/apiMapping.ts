import type { GroupCostRecord, UsageMetricRecord, UserActivityRecord } from "@cost-reporting/connector-core";
import type { FocusRecord } from "@cost-reporting/focus-schema";
import type { DailyUsageRow, UsageAmounts } from "./adminApi.js";

/**
 * Daily Usage rows (see adminApi.ts) to the records the rest of the system
 * stores. No I/O here, so it's tested on its own.
 */
export interface ApiMappingConfig {
  workspaceName?: string;
  creditPriceUsd?: number;
}

// Amounts below this are float noise, not a charge (dollars).
const EPSILON = 1e-6;

/**
 * Dollars for one amount. `cost_usd` is native USD-priced usage; `credits` is
 * credit-priced usage, valued at the contract's price when set, else at
 * OpenAI's `estimated_cost_usd` (which uses the overage rate, so it can run
 * higher than committed-credit pricing). Credits and dollars are never added
 * as if they were the same unit.
 */
export function toUsd(amount: UsageAmounts, creditPriceUsd?: number): number {
  const usd = amount.cost_usd ?? 0;
  if (!amount.credits) return usd;
  return usd + (creditPriceUsd != null ? amount.credits * creditPriceUsd : (amount.estimated_cost_usd ?? 0));
}

function period(row: DailyUsageRow) {
  const start = new Date(row.start_time * 1000);
  return {
    ChargePeriodStart: start,
    ChargePeriodEnd: new Date(row.end_time * 1000),
    BillingPeriodStart: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)),
    BillingPeriodEnd: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
  };
}

function account(config: ApiMappingConfig) {
  return {
    ProviderName: "OpenAI" as const,
    BillingAccountId: config.workspaceName ?? "chatgpt-enterprise",
    BillingAccountName: config.workspaceName ?? "ChatGPT Enterprise",
    ServiceCategory: "AI and Machine Learning",
    ChargeCategory: "Usage" as const,
    BillingCurrency: "USD",
    Tags: {},
  };
}

/** Keyed by email, like the CSV imports, so a person is one person across reports. */
export function identity(row: DailyUsageRow): { id: string; email?: string } | null {
  const email = row.actor?.email?.trim().toLowerCase();
  if (email) return { id: email, email };
  const id = row.actor?.user_id ?? row.user_id;
  return id ? { id } : null;
}

const clientLabel = (clientId: string | null) => clientId || "Other";

function creditsNote(credits: number | null | undefined): Partial<FocusRecord> {
  return credits
    ? { ChargeDescription: `${credits.toFixed(2)} credits`, PricingQuantity: credits, PricingUnit: "credits" }
    : {};
}

/**
 * One person-day as cost rows, one per client (ChatGPT web, Codex CLI, …).
 * The API says client amounts can sum to less than the row's totals, so the
 * difference becomes an "Other" row; if a breakdown ever sums to more, the
 * row's total is booked as one line instead, so totals always match the API.
 */
export function userCostRecords(row: DailyUsageRow, config: ApiMappingConfig): FocusRecord[] {
  const who = identity(row);
  const total = toUsd(row.totals, config.creditPriceUsd);
  if (!who || Math.abs(total) < EPSILON) return [];

  let parts = (row.clients ?? [])
    .map((c) => ({
      service: clientLabel(c.client_id),
      cost: toUsd(c, config.creditPriceUsd),
      credits: c.credits,
    }))
    .filter((p) => Math.abs(p.cost) >= EPSILON);
  const attributed = parts.reduce((sum, p) => sum + p.cost, 0);
  if (attributed > total + EPSILON) {
    parts = [{ service: "ChatGPT", cost: total, credits: row.totals.credits }];
  } else if (total - attributed >= EPSILON) {
    parts.push({ service: "Other", cost: total - attributed, credits: null });
  }

  return parts.map((p) => ({
    ...account(config),
    ...period(row),
    BilledCost: p.cost,
    EffectiveCost: p.cost,
    ServiceName: p.service,
    ...creditsNote(p.credits),
    x_UserId: who.id,
    x_UserEmail: who.email,
  }));
}

/**
 * Per-user rows leave out users deleted since; the workspace rows don't. The
 * difference for each day is booked unattributed, so ChatGPT totals match the
 * workspace's.
 */
export function unattributedCostRecords(
  workspaceRows: DailyUsageRow[],
  userRows: DailyUsageRow[],
  config: ApiMappingConfig,
): FocusRecord[] {
  const userTotals = new Map<number, number>();
  for (const row of userRows) {
    if (!identity(row)) continue;
    userTotals.set(
      row.start_time,
      (userTotals.get(row.start_time) ?? 0) + toUsd(row.totals, config.creditPriceUsd),
    );
  }
  return workspaceRows.flatMap((row) => {
    const gap = toUsd(row.totals, config.creditPriceUsd) - (userTotals.get(row.start_time) ?? 0);
    if (gap < EPSILON) return [];
    return [
      {
        ...account(config),
        ...period(row),
        BilledCost: gap,
        EffectiveCost: gap,
        ServiceName: "ChatGPT",
        ChargeDescription: "Usage not attributed to a current workspace member",
      },
    ];
  });
}

/** Messages and chats for one person-day, or null when there were none. */
export function userActivityRecord(row: DailyUsageRow): UserActivityRecord | null {
  const who = identity(row);
  const messageCount = row.totals.messages ?? 0;
  const sessionCount = row.totals.chats ?? 0;
  if (!who || (messageCount === 0 && sessionCount === 0)) return null;
  return {
    date: new Date(row.start_time * 1000),
    userId: who.id,
    userEmail: who.email,
    messageCount,
    sessionCount,
  };
}

/**
 * Breakdowns for the dashboard, from the same days: spend by model and
 * messages/tokens by client from the workspace rows, and daily active users
 * per client counted from the per-user rows.
 */
export function usageMetrics(
  workspaceRows: DailyUsageRow[],
  userRows: DailyUsageRow[],
  config: ApiMappingConfig,
): UsageMetricRecord[] {
  const metrics: UsageMetricRecord[] = [];
  const day = (row: DailyUsageRow) => ({
    periodStart: new Date(row.start_time * 1000),
    periodEnd: new Date(row.end_time * 1000),
  });

  for (const row of workspaceRows) {
    for (const m of row.models ?? []) {
      const cost = toUsd(m, config.creditPriceUsd);
      if (Math.abs(cost) < EPSILON) continue;
      metrics.push({
        dimension: "model",
        key: `${m.model ?? "Other"}${m.speed === "fast" ? " (fast)" : ""}`,
        metric: m.credits != null ? "credits" : "cost_usd",
        value: m.credits ?? m.cost_usd ?? 0,
        effectiveCost: cost,
        ...day(row),
      });
    }
    for (const c of row.clients ?? []) {
      if (c.messages) {
        metrics.push({
          dimension: "product",
          key: clientLabel(c.client_id),
          metric: "messages",
          value: c.messages,
          ...day(row),
        });
      }
      if (c.text_total_tokens) {
        metrics.push({
          dimension: "product",
          key: clientLabel(c.client_id),
          metric: "tokens",
          value: c.text_total_tokens,
          ...day(row),
        });
      }
    }
  }

  const activeUsers = new Map<string, { row: DailyUsageRow; client: string; count: number }>();
  for (const row of userRows) {
    for (const c of row.clients ?? []) {
      if (!c.messages) continue;
      const client = clientLabel(c.client_id);
      const key = `${row.start_time}|${client}`;
      const entry = activeUsers.get(key) ?? { row, client, count: 0 };
      entry.count++;
      activeUsers.set(key, entry);
    }
  }
  for (const { row, client, count } of activeUsers.values()) {
    metrics.push({ dimension: "product", key: client, metric: "active_users", value: count, ...day(row) });
  }
  return metrics;
}

/** One group's daily cost (its current members' usage), for GroupCost. */
export function groupCostRecords(
  group: { id: string; name?: string | null },
  rows: DailyUsageRow[],
  config: ApiMappingConfig,
): GroupCostRecord[] {
  return rows.flatMap((row) => {
    const cost = toUsd(row.totals, config.creditPriceUsd);
    if (Math.abs(cost) < EPSILON) return [];
    return [
      {
        groupId: group.id,
        groupName: group.name ?? undefined,
        chargePeriodStart: new Date(row.start_time * 1000),
        chargePeriodEnd: new Date(row.end_time * 1000),
        effectiveCost: cost,
        billingCurrency: "USD",
      },
    ];
  });
}
