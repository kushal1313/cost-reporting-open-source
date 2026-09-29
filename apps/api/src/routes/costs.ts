import { Prisma, prisma } from "@cost-reporting/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const GROUPABLE_FIELDS = [
  "providerName",
  "serviceCategory",
  "serviceName",
  "billingAccountId",
  "account",
] as const;

const accountIdsSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

const querySchema = z.object({
  organizationId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  groupBy: z.enum(GROUPABLE_FIELDS).default("providerName"),
  accountIds: accountIdsSchema,
  provider: z.string().optional(),
});

const trendQuerySchema = z.object({
  organizationId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  accountIds: accountIdsSchema,
  provider: z.string().optional(),
});

const accountsQuerySchema = z.object({
  organizationId: z.string(),
  provider: z.string().optional(),
});

/**
 * "Account" isn't a single CostRecord column — a linked/sub-account (AWS
 * LINKED_ACCOUNT, etc.) falls back to the connector's billingAccountId when a
 * provider has no sub-account concept. This SQL fragment is appended (raw,
 * since Prisma's query builder can't express a cross-column COALESCE) to scope
 * queries to a chosen set of accounts either way.
 */
function accountFilterSql(accountIds?: string[]) {
  if (!accountIds || accountIds.length === 0) return Prisma.sql``;
  return Prisma.sql`AND COALESCE("subAccountId", "billingAccountId") IN (${Prisma.join(accountIds)})`;
}

function providerFilterSql(provider?: string) {
  if (!provider) return Prisma.sql``;
  return Prisma.sql`AND "providerName" = ${provider}`;
}

export async function costRoutes(app: FastifyInstance) {
  // Distinct accounts with cost data, for populating an account filter in the UI.
  app.get("/costs/accounts", async (req) => {
    const { organizationId, provider } = accountsQuerySchema.parse(req.query);
    const rows = await prisma.$queryRaw<
      Array<{ account_id: string; account_name: string; provider_name: string }>
    >`
      SELECT DISTINCT
        COALESCE("subAccountId", "billingAccountId") AS account_id,
        COALESCE("subAccountName", "billingAccountName", "subAccountId", "billingAccountId") AS account_name,
        "providerName" AS provider_name
      FROM "CostRecord"
      WHERE "organizationId" = ${organizationId}
        ${providerFilterSql(provider)}
      ORDER BY 3, 1
    `;
    return rows.map((r) => ({
      accountId: r.account_id,
      accountName: r.account_name,
      provider: r.provider_name,
    }));
  });

  // Breakdown by a single dimension, e.g. spend per provider, service, or account.
  app.get("/costs", async (req) => {
    const { organizationId, from, to, groupBy, accountIds, provider } = querySchema.parse(req.query);

    if (groupBy === "account") {
      const rows = await prisma.$queryRaw<
        Array<{ group_key: string; group_label: string; effective_cost: number; billed_cost: number }>
      >`
        SELECT
          COALESCE("subAccountId", "billingAccountId") AS group_key,
          COALESCE("subAccountName", "billingAccountName", "subAccountId", "billingAccountId") AS group_label,
          SUM("effectiveCost")::float AS effective_cost,
          SUM("billedCost")::float AS billed_cost
        FROM "CostRecord"
        WHERE "organizationId" = ${organizationId}
          AND "chargePeriodStart" <= ${to}
          AND "chargePeriodEnd" >= ${from}
          ${accountFilterSql(accountIds)}
          ${providerFilterSql(provider)}
        GROUP BY 1, 2
        ORDER BY 3 DESC
      `;
      return rows.map((r) => ({
        group: r.group_label,
        effectiveCost: r.effective_cost,
        billedCost: r.billed_cost,
      }));
    }

    // Overlap test, not containment: a monthly-granularity record (e.g. Datadog,
    // one row spanning a whole calendar month) would otherwise be silently
    // dropped by a rolling "last 30 days" window that doesn't align to its
    // start/end, even though it clearly overlaps the requested range.
    const where: Prisma.CostRecordWhereInput = {
      organizationId,
      chargePeriodStart: { lte: to },
      chargePeriodEnd: { gte: from },
    };
    if (provider) where.providerName = provider;
    if (accountIds && accountIds.length > 0) {
      where.OR = [
        { subAccountId: { in: accountIds } },
        { AND: [{ subAccountId: null }, { billingAccountId: { in: accountIds } }] },
      ];
    }

    const rows = await prisma.costRecord.groupBy({
      by: [groupBy],
      where,
      _sum: { effectiveCost: true, billedCost: true },
      orderBy: { _sum: { effectiveCost: "desc" } },
    });

    return rows.map((r) => ({
      group: r[groupBy],
      effectiveCost: Number(r._sum.effectiveCost ?? 0),
      billedCost: Number(r._sum.billedCost ?? 0),
    }));
  });

  // Daily total spend across the range, for a trend line.
  //
  // Note: a monthly-granularity record (Datadog) has its full cost bucketed
  // onto its chargePeriodStart day rather than spread across the month — this
  // makes the trend chart show a spike on the 1st for such providers instead
  // of a smooth daily line. Getting that right needs pro-rating cost across
  // the record's date range, which is worth doing deliberately rather than
  // bolting on here; daily-granularity providers (AWS) are unaffected.
  app.get("/costs/trend", async (req) => {
    const { organizationId, from, to, accountIds, provider } = trendQuerySchema.parse(req.query);

    const rows = await prisma.$queryRaw<Array<{ day: Date; effective_cost: number }>>`
      SELECT date_trunc('day', "chargePeriodStart") AS day, SUM("effectiveCost")::float AS effective_cost
      FROM "CostRecord"
      WHERE "organizationId" = ${organizationId}
        AND "chargePeriodStart" <= ${to}
        AND "chargePeriodEnd" >= ${from}
        ${accountFilterSql(accountIds)}
        ${providerFilterSql(provider)}
      GROUP BY 1
      ORDER BY 1
    `;

    return rows.map((r) => ({ date: r.day, effectiveCost: r.effective_cost }));
  });
}
