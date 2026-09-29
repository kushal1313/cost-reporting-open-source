import type { CostConnector, DateRange, Scope } from "@cost-reporting/connector-core";
import type { FocusRecord } from "@cost-reporting/focus-schema";

export interface DatadogConnectorConfig {
  apiKey: string;
  appKey: string;
  /** Datadog site, e.g. "datadoghq.com", "datadoghq.eu", "us3.datadoghq.com". */
  site?: string;
}

interface DatadogCostCharge {
  charge_type: string;
  product_name: string;
  cost: number;
}

interface DatadogCostAttributes {
  org_name: string;
  public_id: string;
  date: string; // ISO month start
  total_cost: number;
  charges: DatadogCostCharge[];
}

interface DatadogCostResponse {
  data: Array<{ type: string; id: string; attributes: DatadogCostAttributes }>;
}

/**
 * The Datadog "site" is a bare domain like "datadoghq.com" or "us5.datadoghq.com"
 * — but the value visible to users day-to-day is the app URL, "app.datadoghq.com"
 * or "app.us5.datadoghq.com". Using that verbatim would build "api.app.datadoghq.com",
 * which fails TLS validation (the cert only covers *.datadoghq.com, one level deep).
 * Strip a leading "app." and any accidental scheme/path so both forms work.
 */
function normalizeSite(site: string): string {
  return site
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^app\./, "")
    .replace(/\/.*$/, "");
}

function baseUrl(config: DatadogConnectorConfig): string {
  return `https://api.${normalizeSite(config.site ?? "datadoghq.com")}`;
}

function authHeaders(config: DatadogConnectorConfig): Record<string, string> {
  return {
    "DD-API-KEY": config.apiKey,
    "DD-APPLICATION-KEY": config.appKey,
  };
}

function monthStamp(date: Date): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

/** Every first-of-month between range.start and range.end, inclusive. */
function monthsInRange(range: DateRange): Date[] {
  const months: Date[] = [];
  let cursor = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth(), 1));
  const end = new Date(Date.UTC(range.end.getUTCFullYear(), range.end.getUTCMonth(), 1));
  while (cursor <= end) {
    months.push(cursor);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

async function fetchCostByOrg(
  config: DatadogConnectorConfig,
  startMonth: Date,
  endMonth: Date,
): Promise<DatadogCostResponse> {
  const url = new URL("/api/v2/usage/cost_by_org", baseUrl(config));
  url.searchParams.set("start_month", monthStamp(startMonth));
  url.searchParams.set("end_month", monthStamp(endMonth));
  const res = await fetch(url, { headers: authHeaders(config) });
  if (!res.ok) {
    throw new Error(`Datadog cost_by_org request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as DatadogCostResponse;
}

export const datadogConnector: CostConnector<DatadogConnectorConfig> = {
  provider: "Datadog",
  displayName: "Datadog",

  async validateCredentials(config) {
    const res = await fetch(new URL("/api/v1/validate", baseUrl(config)), { headers: authHeaders(config) });
    return res.ok;
  },

  async listScopes(config) {
    const now = new Date();
    const data = await fetchCostByOrg(config, now, now);
    const scopes = new Map<string, Scope>();
    for (const item of data.data) {
      scopes.set(item.attributes.public_id, {
        id: item.attributes.public_id,
        name: item.attributes.org_name,
        type: "org",
      });
    }
    return [...scopes.values()];
  },

  async *syncCosts(config, range: DateRange): AsyncGenerator<FocusRecord> {
    const months = monthsInRange(range);
    if (months.length === 0) return;

    const data = await fetchCostByOrg(config, months[0], months[months.length - 1]);

    for (const item of data.data) {
      const periodStart = new Date(item.attributes.date);
      const periodEnd = new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));

      for (const charge of item.attributes.charges) {
        const record: FocusRecord = {
          BilledCost: charge.cost,
          EffectiveCost: charge.cost,
          BillingCurrency: "USD",
          ChargePeriodStart: periodStart,
          ChargePeriodEnd: periodEnd,
          BillingPeriodStart: periodStart,
          BillingPeriodEnd: periodEnd,
          ProviderName: "Datadog",
          BillingAccountId: item.attributes.public_id,
          BillingAccountName: item.attributes.org_name,
          ServiceCategory: "Observability",
          ServiceName: charge.product_name,
          ChargeCategory: "Usage",
          ChargeDescription: charge.charge_type,
          Tags: {},
        };
        yield record;
      }
    }
  },
};

export default datadogConnector;
