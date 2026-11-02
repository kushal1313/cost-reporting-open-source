import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaAnalyticsActor,
  BetaAnalyticsUserActivity,
} from "@anthropic-ai/sdk/resources/beta/organization/analytics/analytics";
import type { BetaAnalyticsCostItem } from "@anthropic-ai/sdk/resources/beta/organization/analytics/cost";
import type {
  CostConnector,
  DateRange,
  GroupCostRecord,
  UserActivityRecord,
} from "@cost-reporting/connector-core";
import type { FocusRecord } from "@cost-reporting/focus-schema";

/**
 * Claude Enterprise (claude.ai) cost and activity, via the Usage and Cost
 * Analytics API and the Claude Enterprise Analytics API.
 *
 * Dollar figures are only per-user for usage-based Enterprise plans; on
 * seat-based plans the cost endpoint covers usage credits only, and seat fees
 * come from the connector's seat plan instead.
 */
export interface ClaudeEnterpriseConnectorConfig {
  /**
   * Analytics API key (`read:analytics` scope), created by the org's primary
   * owner at claude.ai > Organization settings > API.
   */
  apiKey: string;
  /** Label for this org in reports; defaults to "Claude Enterprise". */
  organizationName?: string;
}

// Earliest date the analytics endpoints serve, and their per-request span limit.
const EARLIEST_DATA = Date.UTC(2026, 0, 1);
const MAX_SPAN_DAYS = 31;
const LOOKBACK_DAYS = 365;
const DAY_MS = 86_400_000;
const PAGE_SIZE = 1000;

const PRODUCT_LABELS: Record<string, string> = {
  chat: "Claude chat",
  chat_cowork_unified: "Claude chat & Cowork",
  claude_code: "Claude Code",
  cowork: "Cowork",
  office_agent: "Claude for Office",
  claude_in_chrome: "Claude in Chrome",
  claude_design: "Claude Design",
  claude_tag: "Claude in Slack",
};

function buildClient(config: ClaudeEnterpriseConnectorConfig): Anthropic {
  // authToken: null so an ANTHROPIC_AUTH_TOKEN in the server's environment is
  // never sent alongside this org's key. The analytics endpoints are
  // rate-limited per org (60/min), so allow more 429 retries than the default.
  return new Anthropic({ apiKey: config.apiKey, authToken: null, maxRetries: 5 });
}

function toDateStamp(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Narrows `range` to what the API serves: on/after 2026-01-01, within the last 365 days, not in the future. */
function clampRange(range: DateRange, now = Date.now()): DateRange | null {
  const earliest = Math.max(EARLIEST_DATA, Math.ceil((now - LOOKBACK_DAYS * DAY_MS) / DAY_MS) * DAY_MS);
  const start = new Date(Math.max(range.start.getTime(), earliest));
  const end = new Date(Math.min(range.end.getTime(), Math.ceil(now / DAY_MS) * DAY_MS));
  return start < end ? { start, end } : null;
}

/** Splits a range into consecutive windows the API accepts in one request. */
function windows(range: DateRange): DateRange[] {
  const result: DateRange[] = [];
  let start = range.start;
  while (start < range.end) {
    const end = new Date(Math.min(start.getTime() + MAX_SPAN_DAYS * DAY_MS, range.end.getTime()));
    result.push({ start, end });
    start = end;
  }
  return result;
}

/** Amounts are decimal strings in cents. */
function centsToDollars(amount: string): number {
  return Number(amount) / 100;
}

export function actorIdentity(actor: BetaAnalyticsActor | null): {
  id?: string;
  email?: string;
  name?: string;
} {
  if (!actor) return {};
  switch (actor.type) {
    case "user_actor":
      return {
        id: actor.user_id,
        email: actor.email_address ?? undefined,
        name: actor.name ?? undefined,
      };
    case "service_account_actor":
      return { id: actor.service_account_id, name: `Service account ${actor.service_account_id}` };
    case "api_actor":
      return { id: actor.api_key_id, name: `API key ${actor.api_key_id}` };
    case "federated_actor":
      return actor.subject ? { id: actor.subject, name: `Federated identity ${actor.subject}` } : {};
  }
}

export function productLabel(product: string | null): string {
  return (product && PRODUCT_LABELS[product]) ?? "Other";
}

export function toFocusRecord(
  item: BetaAnalyticsCostItem,
  config: ClaudeEnterpriseConnectorConfig,
): FocusRecord {
  const chargePeriodStart = new Date(item.starting_at);
  const { start: billingPeriodStart, end: billingPeriodEnd } = monthBounds(chargePeriodStart);
  const who = actorIdentity(item.group.actor);
  return {
    BilledCost: centsToDollars(item.cost.amount),
    EffectiveCost: centsToDollars(item.cost.amount),
    ListCost: centsToDollars(item.cost.list_amount),
    BillingCurrency: item.cost.currency,
    ChargePeriodStart: chargePeriodStart,
    ChargePeriodEnd: new Date(item.ending_at),
    BillingPeriodStart: billingPeriodStart,
    BillingPeriodEnd: billingPeriodEnd,
    ProviderName: "Anthropic",
    BillingAccountId: config.organizationName ?? "claude-enterprise",
    BillingAccountName: config.organizationName ?? "Claude Enterprise",
    ServiceCategory: "AI and Machine Learning",
    ServiceName: productLabel(item.group.product),
    ChargeCategory: "Usage",
    ChargeDescription: item.group.model ?? undefined,
    Tags: {},
    x_UserId: who.id,
    x_UserEmail: who.email,
    x_UserName: who.name,
  };
}

/** One person-day of activity, or null when the row has no identifiable user or no activity. */
export function toActivityRecord(day: Date, row: BetaAnalyticsUserActivity): UserActivityRecord | null {
  if (!row.user) return null;
  const messageCount =
    row.chat_metrics.message_count +
    row.cowork_metrics.message_count +
    (row.chat_cowork_unified_metrics?.chat.message_count ?? 0);
  const sessionCount =
    (row.claude_code_metrics.core_metrics.distinct_session_count ?? 0) +
    (row.cowork_metrics.distinct_session_count ?? 0);
  if (messageCount === 0 && sessionCount === 0) return null;
  return {
    date: day,
    userId: row.user.id,
    userEmail: row.user.email_address,
    messageCount,
    sessionCount,
  };
}

function isAuthError(err: unknown): boolean {
  return err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError;
}

export const claudeEnterpriseConnector: CostConnector<ClaudeEnterpriseConnectorConfig> = {
  provider: "Anthropic",
  displayName: "Claude Enterprise",

  async validateCredentials(config) {
    const client = buildClient(config);
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    try {
      await client.beta.organization.analytics.cost.list({
        starting_at: new Date(hour - DAY_MS).toISOString(),
        limit: 1,
      });
      return true;
    } catch (err) {
      if (isAuthError(err)) return false;
      throw err;
    }
  },

  async listScopes(config) {
    return [
      {
        id: config.organizationName ?? "claude-enterprise",
        name: config.organizationName ?? "Claude Enterprise",
        type: "org",
      },
    ];
  },

  // Daily cost per person, product and model. Grouping by actor partitions the
  // total (each request has one actor), so these rows sum to the org's spend;
  // usage no one can be tied to arrives with a null actor.
  async *syncCosts(config, range) {
    const clamped = clampRange(range);
    if (!clamped) return;
    const client = buildClient(config);
    for (const w of windows(clamped)) {
      for await (const item of client.beta.organization.analytics.cost.list({
        starting_at: w.start.toISOString(),
        ending_at: w.end.toISOString(),
        time_bucket_width: "1d",
        group_by: ["actor", "product", "model"],
        limit: PAGE_SIZE,
      })) {
        if (Number(item.cost.amount) === 0) continue;
        yield toFocusRecord(item, config);
      }
    }
  },

  // Daily cost per team. Teams use any-membership semantics — a member of two
  // teams counts in full toward both — which is why these go to GroupCost and
  // never into the cost totals.
  async *syncGroupCosts(config, range) {
    const clamped = clampRange(range);
    if (!clamped) return;
    const client = buildClient(config);

    let groupNames: Map<string, string>;
    try {
      groupNames = await fetchGroupNames(client, clamped);
    } catch (err) {
      // Teams aren't available to every Enterprise org; the API answers 400.
      if (err instanceof Anthropic.BadRequestError) return;
      throw err;
    }

    for (const w of windows(clamped)) {
      for await (const item of client.beta.organization.analytics.cost.list({
        starting_at: w.start.toISOString(),
        ending_at: w.end.toISOString(),
        time_bucket_width: "1d",
        group_by: ["rbac_group_id"],
        limit: PAGE_SIZE,
      })) {
        if (Number(item.cost.amount) === 0) continue;
        const groupId = item.group.rbac_group_id;
        const record: GroupCostRecord = {
          groupId,
          groupName: groupId ? groupNames.get(groupId) : undefined,
          chargePeriodStart: new Date(item.starting_at),
          chargePeriodEnd: new Date(item.ending_at),
          effectiveCost: centsToDollars(item.cost.amount),
          billingCurrency: item.cost.currency,
        };
        yield record;
      }
    }
  },

  // One request per day: the activity endpoint returns one row per member for
  // a single date. Recent days aren't published yet (about a 1-day lag); the
  // API rejects those with a 400, which just means "not yet".
  async *syncUserActivity(config, range) {
    const clamped = clampRange(range);
    if (!clamped) return;
    const client = buildClient(config);
    const notYetPublished = Date.now() - 3 * DAY_MS;
    for (let t = clamped.start.getTime(); t < clamped.end.getTime(); t += DAY_MS) {
      const day = new Date(t);
      try {
        for await (const row of client.beta.organization.analytics.users.list({
          date: toDateStamp(day),
          limit: PAGE_SIZE,
        })) {
          const record = toActivityRecord(day, row);
          if (record) yield record;
        }
      } catch (err) {
        if (err instanceof Anthropic.BadRequestError && t >= notYetPublished) continue;
        throw err;
      }
    }
  },

  async getSeatCount(config) {
    const client = buildClient(config);
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    let seats: number | null = null;
    try {
      for await (const day of client.beta.organization.analytics.summaries.list({
        starting_date: toDateStamp(new Date(today - 10 * DAY_MS)),
        ending_date: toDateStamp(new Date(today - 2 * DAY_MS)),
      })) {
        seats = day.assigned_seat_count ?? seats;
      }
    } catch (err) {
      if (isAuthError(err)) throw err;
      return null;
    }
    return seats;
  },
};

/** Team id -> display name, from the activity endpoint (cost rows carry only the id). */
async function fetchGroupNames(client: Anthropic, range: DateRange): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const end = new Date(Math.min(range.end.getTime(), today));
  if (end <= range.start) return names;
  for await (const row of client.beta.organization.analytics.users.list({
    starting_date: toDateStamp(range.start),
    ending_date: toDateStamp(end),
    group_by: ["rbac_group_id"],
    limit: PAGE_SIZE,
  })) {
    if (row.rbac_group_id && row.rbac_group_name) names.set(row.rbac_group_id, row.rbac_group_name);
  }
  return names;
}

export default claudeEnterpriseConnector;
