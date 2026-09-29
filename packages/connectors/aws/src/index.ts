import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetDimensionValuesCommand,
  type GetCostAndUsageCommandOutput,
} from "@aws-sdk/client-cost-explorer";
import { fromNodeProviderChain, fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { CostConnector, DateRange } from "@cost-reporting/connector-core";
import type { FocusRecord } from "@cost-reporting/focus-schema";
import { inferServiceCategory } from "./serviceCategory.js";

export interface AwsConnectorConfig {
  /** The payer/linked account id this connector instance reports costs for. */
  billingAccountId: string;
  /** Preferred over static keys: a read-only role (e.g. scoped to ce:Get*, ce:Describe*). */
  roleArn?: string;
  externalId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /**
   * Named profile from the machine's ~/.aws/config to source credentials from
   * (e.g. an `aws sso login`'d SSO profile) when neither roleArn nor static
   * keys are given. Falls back to AWS_PROFILE / the default profile if unset.
   */
  profile?: string;
}

// Cost Explorer is a global-billing API that only lives in us-east-1.
const CE_REGION = "us-east-1";

function buildClient(config: AwsConnectorConfig): CostExplorerClient {
  if (config.roleArn) {
    return new CostExplorerClient({
      region: CE_REGION,
      credentials: fromTemporaryCredentials({
        params: {
          RoleArn: config.roleArn,
          ExternalId: config.externalId,
          RoleSessionName: "cost-reporting-sync",
        },
      }),
    });
  }
  if (config.accessKeyId && config.secretAccessKey) {
    return new CostExplorerClient({
      region: CE_REGION,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
    });
  }
  // Falls back to the default provider chain (env vars, shared config/SSO profile, instance/task role).
  return new CostExplorerClient({
    region: CE_REGION,
    credentials: fromNodeProviderChain({ profile: config.profile }),
  });
}

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD, required by Cost Explorer
}

function monthBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Maps linked account id -> its friendly name, e.g. "111122223333" -> "prod". */
async function fetchLinkedAccountNames(
  client: CostExplorerClient,
  range: DateRange,
): Promise<Map<string, string>> {
  const result = await client.send(
    new GetDimensionValuesCommand({
      Dimension: "LINKED_ACCOUNT",
      TimePeriod: { Start: toDateStamp(range.start), End: toDateStamp(range.end) },
    }),
  );
  const names = new Map<string, string>();
  for (const v of result.DimensionValues ?? []) {
    if (v.Value) names.set(v.Value, v.Attributes?.description ?? v.Value);
  }
  return names;
}

export const awsConnector: CostConnector<AwsConnectorConfig> = {
  provider: "AWS",
  displayName: "Amazon Web Services",

  async validateCredentials(config) {
    const client = buildClient(config);
    try {
      await client.send(
        new GetDimensionValuesCommand({
          Dimension: "SERVICE",
          TimePeriod: { Start: toDateStamp(new Date(Date.now() - 86400000)), End: toDateStamp(new Date()) },
        }),
      );
      return true;
    } catch {
      return false;
    } finally {
      client.destroy();
    }
  },

  async listScopes(config) {
    const client = buildClient(config);
    try {
      const names = await fetchLinkedAccountNames(client, {
        start: new Date(Date.now() - 30 * 86400000),
        end: new Date(),
      });
      return [...names.entries()].map(([id, name]) => ({ id, name, type: "account" }));
    } finally {
      client.destroy();
    }
  },

  async *syncCosts(config, range: DateRange): AsyncGenerator<FocusRecord> {
    const client = buildClient(config);
    try {
      const linkedAccountNames = await fetchLinkedAccountNames(client, range);

      let nextPageToken: string | undefined;
      do {
        const page: GetCostAndUsageCommandOutput = await client.send(
          new GetCostAndUsageCommand({
            TimePeriod: { Start: toDateStamp(range.start), End: toDateStamp(range.end) },
            Granularity: "DAILY",
            Metrics: ["UnblendedCost", "NetUnblendedCost"],
            GroupBy: [
              { Type: "DIMENSION", Key: "SERVICE" },
              { Type: "DIMENSION", Key: "LINKED_ACCOUNT" },
            ],
            NextPageToken: nextPageToken,
          }),
        );

        for (const byTime of page.ResultsByTime ?? []) {
          const chargePeriodStart = new Date(`${byTime.TimePeriod?.Start}T00:00:00Z`);
          const chargePeriodEnd = new Date(`${byTime.TimePeriod?.End}T00:00:00Z`);
          const { start: billingPeriodStart, end: billingPeriodEnd } = monthBounds(chargePeriodStart);

          for (const group of byTime.Groups ?? []) {
            const [serviceName, linkedAccount] = group.Keys ?? [];
            const billed = group.Metrics?.UnblendedCost;
            const effective = group.Metrics?.NetUnblendedCost ?? group.Metrics?.UnblendedCost;
            if (!billed) continue;

            const record: FocusRecord = {
              BilledCost: Number(billed.Amount ?? 0),
              EffectiveCost: Number(effective?.Amount ?? billed.Amount ?? 0),
              BillingCurrency: billed.Unit ?? "USD",
              ChargePeriodStart: chargePeriodStart,
              ChargePeriodEnd: chargePeriodEnd,
              BillingPeriodStart: billingPeriodStart,
              BillingPeriodEnd: billingPeriodEnd,
              ProviderName: "AWS",
              BillingAccountId: config.billingAccountId,
              SubAccountId: linkedAccount,
              SubAccountName: linkedAccount ? linkedAccountNames.get(linkedAccount) : undefined,
              ServiceCategory: inferServiceCategory(serviceName ?? "Other"),
              ServiceName: serviceName ?? "Unknown",
              ChargeCategory: "Usage",
              Tags: {},
            };
            yield record;
          }
        }

        nextPageToken = page.NextPageToken;
      } while (nextPageToken);
    } finally {
      client.destroy();
    }
  },
};

export default awsConnector;
