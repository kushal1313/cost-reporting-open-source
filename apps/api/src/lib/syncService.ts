import {
  ingestionOf,
  type CostConnector,
  type GroupCostRecord,
  type ImportResult,
  type UsageMetricRecord,
  type UserActivityRecord,
  type UserUsageRecord,
} from "@cost-reporting/connector-core";
import { decryptJson, prisma, type ConnectorInstance } from "@cost-reporting/db";
import type { DateRange, FocusRecord } from "@cost-reporting/focus-schema";
import { connectorRegistry } from "./connectorRegistry.js";

const BATCH_SIZE = 500;

function toCostRecordRow(organizationId: string, connectorInstanceId: string, r: FocusRecord) {
  return {
    organizationId,
    connectorInstanceId,
    billedCost: r.BilledCost,
    effectiveCost: r.EffectiveCost,
    billingCurrency: r.BillingCurrency,
    chargePeriodStart: r.ChargePeriodStart,
    chargePeriodEnd: r.ChargePeriodEnd,
    billingPeriodStart: r.BillingPeriodStart,
    billingPeriodEnd: r.BillingPeriodEnd,
    providerName: r.ProviderName,
    billingAccountId: r.BillingAccountId,
    billingAccountName: r.BillingAccountName,
    subAccountId: r.SubAccountId,
    subAccountName: r.SubAccountName,
    serviceCategory: r.ServiceCategory,
    serviceName: r.ServiceName,
    chargeCategory: r.ChargeCategory,
    chargeDescription: r.ChargeDescription,
    resourceId: r.ResourceId,
    resourceName: r.ResourceName,
    resourceType: r.ResourceType,
    regionId: r.RegionId,
    regionName: r.RegionName,
    tags: r.Tags,
    userId: r.x_UserId,
    userEmail: r.x_UserEmail,
    userName: r.x_UserName,
  };
}

const DAY_MS = 86_400_000;

/**
 * Widens a range outward to whole UTC days, as a half-open [start, end)
 * interval. Connectors fetch at day granularity (AWS Cost Explorer truncates to
 * YYYY-MM-DD with an exclusive End), so the window we delete must be exactly
 * the window they return — otherwise a partial-day edge gets deleted and never
 * re-inserted. Rounding `end` up keeps "sync until now" including today.
 */
function toWholeDays(range: DateRange): DateRange {
  const start = new Date(Math.floor(range.start.getTime() / DAY_MS) * DAY_MS);
  const end = new Date(Math.ceil(range.end.getTime() / DAY_MS) * DAY_MS);
  return { start, end: end > start ? end : new Date(start.getTime() + DAY_MS) };
}

async function collect<T>(source: AsyncGenerator<T> | undefined): Promise<T[]> {
  const items: T[] = [];
  if (source) for await (const item of source) items.push(item);
  return items;
}

/**
 * One "Purchase" row per day of `range`: the monthly seat fee (price × seats)
 * pro-rated over that month's days. Daily rows keep any reporting window
 * honest — a rolling 30-day view that spans two months gets 30 days of fees,
 * not two full months — and monthly budgets still sum to the full fee. Not
 * attributed to any user: every seat costs the same, so it would only shift
 * each person's total by the same amount.
 */
function seatFeeRecords(
  instance: ConnectorInstance,
  provider: FocusRecord["ProviderName"],
  seats: number,
  range: DateRange,
): FocusRecord[] {
  const pricePerSeat = Number(instance.seatPricePerMonth);
  const records: FocusRecord[] = [];
  for (let t = range.start.getTime(); t < range.end.getTime(); t += DAY_MS) {
    const day = new Date(t);
    const monthStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1));
    const daysInMonth = (monthEnd.getTime() - monthStart.getTime()) / DAY_MS;
    const cost = (pricePerSeat * seats) / daysInMonth;
    records.push({
      BilledCost: cost,
      EffectiveCost: cost,
      BillingCurrency: "USD",
      ChargePeriodStart: day,
      ChargePeriodEnd: new Date(t + DAY_MS),
      BillingPeriodStart: monthStart,
      BillingPeriodEnd: monthEnd,
      ProviderName: provider,
      BillingAccountId: instance.id,
      BillingAccountName: instance.name,
      SubAccountId: "seats",
      SubAccountName: "Seats (not allocated)",
      ServiceCategory: "AI and Machine Learning",
      ServiceName: "Seats",
      ChargeCategory: "Purchase",
      ChargeDescription: `${seats} seats × $${pricePerSeat.toFixed(2)}/month (from seat plan)`,
      PricingQuantity: seats,
      PricingUnit: "seat-month",
      Tags: {},
    });
  }
  return records;
}

async function resolveSeatCount(
  instance: ConnectorInstance,
  connector: CostConnector<unknown>,
  config: unknown,
): Promise<number | null> {
  if (instance.seatPricePerMonth == null) return null;
  const seats = instance.seatCount ?? (await connector.getSeatCount?.(config)) ?? null;
  if (seats == null) {
    throw new Error(
      "A seat price is set but the seat count is unknown — enter the number of seats in the seat plan",
    );
  }
  return seats;
}

interface IngestedData {
  costs: FocusRecord[];
  groupCosts?: GroupCostRecord[];
  activity?: UserActivityRecord[];
  userUsage?: UserUsageRecord[];
  metrics?: UsageMetricRecord[];
}

/**
 * Stored data to replace, and what replaces it. With a `dataset`, only rows
 * from that dataset are replaced, so an import of one report leaves the
 * others' rows alone; without one, everything the instance stored for the
 * range is.
 */
interface ReplacementPart {
  dataset?: string;
  data: IngestedData;
}

/**
 * Replaces this connector instance's data for `range` — cost rows, group
 * costs, user activity, per-period user usage and usage metrics — in one
 * transaction, so readers (e.g. the dashboard) never observe the brief window
 * where old rows are gone but new ones aren't in yet. Re-running for an
 * overlapping range is idempotent rather than accumulating duplicates.
 */
async function replaceConnectorData(
  instance: ConnectorInstance,
  range: DateRange,
  parts: ReplacementPart[],
): Promise<void> {
  const { organizationId, id: connectorInstanceId, provider } = instance;
  const owner = { organizationId, connectorInstanceId, providerName: provider };

  // Overlap test, not containment — a monthly-granularity record (e.g.
  // Datadog, or a seat fee) whose period isn't fully inside `range` would
  // otherwise survive the delete and get duplicated by the insert below on
  // every re-sync. Strict comparisons because periods are half-open: a record
  // that merely touches an edge (ends at range.start, or starts at range.end)
  // isn't re-fetched, so it must not be deleted.
  const overlapsRange = { chargePeriodStart: { lt: range.end }, chargePeriodEnd: { gt: range.start } };
  const periodOverlapsRange = { periodStart: { lt: range.end }, periodEnd: { gt: range.start } };

  await prisma.$transaction(
    async (tx) => {
      for (const { dataset, data } of parts) {
        const scope = dataset === undefined ? { connectorInstanceId } : { connectorInstanceId, dataset };
        const costRows = data.costs.map((r) => ({
          ...toCostRecordRow(organizationId, connectorInstanceId, r),
          dataset,
        }));
        const groupRows = (data.groupCosts ?? []).map((g) => ({ ...owner, ...g, dataset }));
        const activityRows = (data.activity ?? []).map((a) => ({ ...owner, ...a, dataset }));
        // UserUsage and UsageMetric rows only come from imports, which always name their dataset.
        const usageRows = (data.userUsage ?? []).map((u) => ({ ...owner, ...u, dataset: dataset ?? "" }));
        const metricRows = (data.metrics ?? []).map((m) => ({ ...owner, ...m, dataset: dataset ?? "" }));

        await tx.costRecord.deleteMany({ where: { ...scope, ...overlapsRange } });
        await tx.groupCost.deleteMany({ where: { ...scope, ...overlapsRange } });
        await tx.userActivity.deleteMany({ where: { ...scope, date: { gte: range.start, lt: range.end } } });
        await tx.userUsage.deleteMany({ where: { ...scope, ...periodOverlapsRange } });
        await tx.usageMetric.deleteMany({ where: { ...scope, ...periodOverlapsRange } });
        for (let i = 0; i < costRows.length; i += BATCH_SIZE) {
          await tx.costRecord.createMany({ data: costRows.slice(i, i + BATCH_SIZE) });
        }
        for (let i = 0; i < groupRows.length; i += BATCH_SIZE) {
          await tx.groupCost.createMany({ data: groupRows.slice(i, i + BATCH_SIZE) });
        }
        for (let i = 0; i < activityRows.length; i += BATCH_SIZE) {
          await tx.userActivity.createMany({ data: activityRows.slice(i, i + BATCH_SIZE) });
        }
        for (let i = 0; i < usageRows.length; i += BATCH_SIZE) {
          await tx.userUsage.createMany({ data: usageRows.slice(i, i + BATCH_SIZE) });
        }
        for (let i = 0; i < metricRows.length; i += BATCH_SIZE) {
          await tx.usageMetric.createMany({ data: metricRows.slice(i, i + BATCH_SIZE) });
        }
      }
    },
    { timeout: 60_000 },
  );
}

/**
 * Runs `load` (the provider fetch or file parse) and stores the result,
 * recording success or failure on the connector instance either way.
 */
async function runIngestion(
  instance: ConnectorInstance,
  load: () => Promise<{ range: DateRange; parts: ReplacementPart[] }>,
): Promise<DateRange> {
  try {
    const { range, parts } = await load();
    await replaceConnectorData(instance, range, parts);
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: { status: "ACTIVE", lastSyncAt: new Date(), lastSyncError: null },
    });
    return range;
  } catch (err) {
    await prisma.connectorInstance.update({
      where: { id: instance.id },
      data: { status: "ERROR", lastSyncError: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

/**
 * Pulls fresh data for one API connector instance and stores it. The provider
 * API calls happen before the transaction opens — they can take seconds and
 * must not hold a DB transaction open while they run.
 */
export async function syncConnectorInstance(
  connectorInstanceId: string,
  requested: DateRange,
): Promise<void> {
  const range = toWholeDays(requested);
  const instance = await prisma.connectorInstance.findUniqueOrThrow({ where: { id: connectorInstanceId } });
  const connector = connectorRegistry.get(instance.provider);
  const config = decryptJson(instance.encryptedConfig);
  if (ingestionOf(connector, config) === "file") {
    throw new Error(`${connector.displayName} is updated by importing an export file, not by syncing`);
  }

  await runIngestion(instance, async () => {
    const [costs, groupCosts, activity, metrics, seats] = await Promise.all([
      collect(connector.syncCosts(config, range)),
      collect(connector.syncGroupCosts?.(config, range)),
      collect(connector.syncUserActivity?.(config, range)),
      collect(connector.syncMetrics?.(config, range)),
      resolveSeatCount(instance, connector, config),
    ]);
    if (seats != null)
      costs.push(
        ...seatFeeRecords(instance, connector.provider as FocusRecord["ProviderName"], seats, range),
      );
    return { range, parts: [{ data: { costs, groupCosts, activity, metrics } }] };
  });
}

/**
 * Stores one uploaded export for a "file" connector instance. A file that
 * names its dataset replaces only that dataset's rows; seat fees are their own
 * dataset, rebooked for the file's dates on every import.
 */
export async function importConnectorFile(
  connectorInstanceId: string,
  content: string,
  fileName?: string,
): Promise<{ range: DateRange; dataset?: ImportResult["dataset"] }> {
  const instance = await prisma.connectorInstance.findUniqueOrThrow({ where: { id: connectorInstanceId } });
  const connector = connectorRegistry.get(instance.provider);
  const parseImport = connector.parseImport?.bind(connector);
  if (!parseImport) {
    throw new Error(`${connector.displayName} doesn't support file import`);
  }
  const config = decryptJson(instance.encryptedConfig);
  // A sync replaces everything in its range, so an import into a syncing
  // connector would either double count or be wiped by the next sync.
  if (ingestionOf(connector, config) === "api") {
    throw new Error(`This ${connector.displayName} connector syncs from the provider's API, not from files`);
  }

  let dataset: ImportResult["dataset"];
  const range = await runIngestion(instance, async () => {
    const { range: fileRange, dataset: parsedDataset, ...data } = parseImport(config, content, fileName);
    dataset = parsedDataset;
    const range = toWholeDays(fileRange);
    const seats = await resolveSeatCount(instance, connector, config);
    const seatCosts =
      seats == null
        ? []
        : seatFeeRecords(instance, connector.provider as FocusRecord["ProviderName"], seats, range);
    if (!dataset) return { range, parts: [{ data: { ...data, costs: [...data.costs, ...seatCosts] } }] };
    return {
      range,
      parts: [
        { dataset: dataset.key, data },
        { dataset: "seats", data: { costs: seatCosts } },
      ],
    };
  });
  return { range, dataset };
}
