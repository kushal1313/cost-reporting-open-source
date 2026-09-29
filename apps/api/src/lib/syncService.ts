import { decryptJson, prisma } from "@cost-reporting/db";
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
  };
}

/**
 * Pulls fresh cost data for one connector instance and stores it. Re-running for
 * an overlapping range first deletes existing rows in that window so the sync is
 * idempotent, rather than accumulating duplicates.
 *
 * The provider API call happens *before* the transaction opens — it can take
 * seconds and must not hold a DB transaction open while it runs. The
 * delete-then-insert is then wrapped in one transaction so readers (e.g. the
 * dashboard) never observe the brief window where old rows are gone but new
 * ones aren't in yet.
 */
export async function syncConnectorInstance(connectorInstanceId: string, range: DateRange): Promise<void> {
  const instance = await prisma.connectorInstance.findUniqueOrThrow({ where: { id: connectorInstanceId } });
  const connector = connectorRegistry.get(instance.provider);
  const config = decryptJson(instance.encryptedConfig);

  try {
    const rows: ReturnType<typeof toCostRecordRow>[] = [];
    for await (const record of connector.syncCosts(config, range)) {
      rows.push(toCostRecordRow(instance.organizationId, connectorInstanceId, record));
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.costRecord.deleteMany({
          where: {
            connectorInstanceId,
            // Overlap test, not containment — a monthly-granularity record
            // (e.g. Datadog) whose period isn't fully inside `range` would
            // otherwise survive the delete and get duplicated by the insert
            // below on every re-sync.
            chargePeriodStart: { lte: range.end },
            chargePeriodEnd: { gte: range.start },
          },
        });
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          await tx.costRecord.createMany({ data: rows.slice(i, i + BATCH_SIZE) });
        }
      },
      { timeout: 60_000 },
    );

    await prisma.connectorInstance.update({
      where: { id: connectorInstanceId },
      data: { status: "ACTIVE", lastSyncAt: new Date(), lastSyncError: null },
    });
  } catch (err) {
    await prisma.connectorInstance.update({
      where: { id: connectorInstanceId },
      data: { status: "ERROR", lastSyncError: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}
