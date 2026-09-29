import type { CostConnector, DateRange, Scope } from "@cost-reporting/connector-core";
import type { FocusRecord } from "@cost-reporting/focus-schema";

/**
 * Grafana Cloud's billing API (grafana.com/api/orgs/{slug}/invoices) is less
 * formally documented than AWS/Datadog's and its response shape can vary by
 * plan. This connector targets the invoice line-item shape as of 2025; verify
 * against your own org's response and adjust `mapInvoiceToRecords` if needed.
 */
export interface GrafanaCloudConnectorConfig {
  orgSlug: string;
  /** Grafana Cloud Access Policy token scoped to billing/invoices:read. */
  accessToken: string;
}

interface GrafanaInvoiceLine {
  description: string;
  amount: number; // USD
  quantity?: number;
  unit?: string;
}

interface GrafanaInvoice {
  id: string;
  orgSlug: string;
  periodStart: string; // ISO date
  periodEnd: string; // ISO date
  amount: number; // USD, total
  lines: GrafanaInvoiceLine[];
}

interface GrafanaInvoicesResponse {
  items: GrafanaInvoice[];
}

const API_BASE = "https://grafana.com/api";

function authHeaders(config: GrafanaCloudConnectorConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.accessToken}` };
}

function overlaps(range: DateRange, periodStart: Date, periodEnd: Date): boolean {
  return periodStart < range.end && periodEnd > range.start;
}

function mapInvoiceToRecords(invoice: GrafanaInvoice): FocusRecord[] {
  const periodStart = new Date(invoice.periodStart);
  const periodEnd = new Date(invoice.periodEnd);
  return invoice.lines.map((line) => ({
    BilledCost: line.amount,
    EffectiveCost: line.amount,
    BillingCurrency: "USD",
    ChargePeriodStart: periodStart,
    ChargePeriodEnd: periodEnd,
    BillingPeriodStart: periodStart,
    BillingPeriodEnd: periodEnd,
    ProviderName: "GrafanaCloud" as const,
    BillingAccountId: invoice.orgSlug,
    ServiceCategory: "Observability",
    ServiceName: line.description,
    ChargeCategory: "Usage" as const,
    UsageQuantity: line.quantity,
    UsageUnit: line.unit,
    Tags: {},
  }));
}

export const grafanaCloudConnector: CostConnector<GrafanaCloudConnectorConfig> = {
  provider: "GrafanaCloud",
  displayName: "Grafana Cloud",

  async validateCredentials(config) {
    const res = await fetch(`${API_BASE}/orgs/${config.orgSlug}`, { headers: authHeaders(config) });
    return res.ok;
  },

  async listScopes(config) {
    const res = await fetch(`${API_BASE}/orgs/${config.orgSlug}`, { headers: authHeaders(config) });
    if (!res.ok) throw new Error(`Grafana Cloud org lookup failed: ${res.status}`);
    const org = (await res.json()) as { id: number; slug: string; name: string };
    const scopes: Scope[] = [{ id: String(org.id), name: org.name, type: "org" }];
    return scopes;
  },

  async *syncCosts(config, range: DateRange): AsyncGenerator<FocusRecord> {
    const res = await fetch(`${API_BASE}/orgs/${config.orgSlug}/invoices`, { headers: authHeaders(config) });
    if (!res.ok) {
      throw new Error(`Grafana Cloud invoices request failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as GrafanaInvoicesResponse;

    for (const invoice of data.items) {
      const periodStart = new Date(invoice.periodStart);
      const periodEnd = new Date(invoice.periodEnd);
      if (!overlaps(range, periodStart, periodEnd)) continue;
      for (const record of mapInvoiceToRecords(invoice)) {
        yield record;
      }
    }
  },
};

export default grafanaCloudConnector;
