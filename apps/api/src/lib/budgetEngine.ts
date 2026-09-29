import { decryptJson, prisma, type BudgetPeriod } from "@cost-reporting/db";
import { getNotificationSender } from "@cost-reporting/notifications";

function periodBounds(period: BudgetPeriod, now = new Date()): { start: Date; end: Date } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  switch (period) {
    case "MONTHLY":
      return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
    case "QUARTERLY": {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        start: new Date(Date.UTC(year, quarterStartMonth, 1)),
        end: new Date(Date.UTC(year, quarterStartMonth + 3, 1)),
      };
    }
    case "YEARLY":
      return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year + 1, 0, 1)) };
  }
}

/**
 * Scope filter supports flat matches on a handful of CostRecord columns.
 * Tag-based scoping (e.g. { tags: { team: "platform" } }) is intentionally not
 * supported yet — Postgres JSON partial-match queries need a small query DSL
 * that's worth building deliberately rather than bolting on here.
 */
function buildCostRecordWhere(
  organizationId: string,
  scopeFilter: Record<string, unknown>,
  range: { start: Date; end: Date },
) {
  const where: Record<string, unknown> = {
    organizationId,
    chargePeriodStart: { gte: range.start },
    chargePeriodEnd: { lte: range.end },
  };
  if (typeof scopeFilter.providerName === "string") where.providerName = scopeFilter.providerName;
  if (typeof scopeFilter.serviceCategory === "string") where.serviceCategory = scopeFilter.serviceCategory;
  if (typeof scopeFilter.billingAccountId === "string") where.billingAccountId = scopeFilter.billingAccountId;
  return where;
}

export interface BudgetEvaluation {
  budgetId: string;
  spend: number;
  percentUsed: number;
}

export async function evaluateBudget(budgetId: string): Promise<BudgetEvaluation> {
  const budget = await prisma.budget.findUniqueOrThrow({
    where: { id: budgetId },
    include: { alertRules: { include: { notificationChannel: true } } },
  });

  const range = periodBounds(budget.period);
  const where = buildCostRecordWhere(
    budget.organizationId,
    budget.scopeFilter as Record<string, unknown>,
    range,
  );
  const agg = await prisma.costRecord.aggregate({ where, _sum: { effectiveCost: true } });
  const spend = Number(agg._sum.effectiveCost ?? 0);
  const percentUsed = (spend / Number(budget.amount)) * 100;

  for (const rule of budget.alertRules) {
    if (rule.condition !== "THRESHOLD_PERCENT" || rule.thresholdPercent == null) continue;
    if (percentUsed < rule.thresholdPercent) continue;
    // Don't re-fire on every evaluation once triggered within the current period.
    if (rule.lastTriggeredAt && rule.lastTriggeredAt > range.start) continue;

    const sender = getNotificationSender(rule.notificationChannel.type);
    const channelConfig = decryptJson(rule.notificationChannel.encryptedConfig);
    await sender.send(channelConfig, {
      title: `Budget alert: ${budget.name}`,
      body: `Spend is at ${percentUsed.toFixed(1)}% of the ${budget.period.toLowerCase()} budget (${spend.toFixed(2)} / ${Number(budget.amount).toFixed(2)} ${budget.currency}).`,
      fields: {
        Budget: budget.name,
        Spend: `${spend.toFixed(2)} ${budget.currency}`,
        Threshold: `${rule.thresholdPercent}%`,
      },
    });

    await prisma.alertRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } });
  }

  return { budgetId, spend, percentUsed };
}

export async function evaluateAllBudgets(): Promise<BudgetEvaluation[]> {
  const budgets = await prisma.budget.findMany({ select: { id: true } });
  const results: BudgetEvaluation[] = [];
  for (const b of budgets) {
    results.push(await evaluateBudget(b.id));
  }
  return results;
}
