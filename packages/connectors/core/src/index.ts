import type { DateRange, FocusRecord, Scope } from "@cost-reporting/focus-schema";

export type { DateRange, Scope };

/**
 * Contract every provider connector implements. Adding a new cost source means
 * writing one of these and registering it — nothing else in the system changes.
 */
export interface CostConnector<TConfig = unknown> {
  /** Stable identifier, matches ProviderName in the FOCUS schema (e.g. "AWS"). */
  readonly provider: string;

  /** Human-readable label for the UI (e.g. "Amazon Web Services"). */
  readonly displayName: string;

  /** Cheap check that the provided credentials/config actually work. */
  validateCredentials(config: TConfig): Promise<boolean>;

  /** List the billable scopes (accounts/subscriptions/projects/orgs) visible to these credentials. */
  listScopes(config: TConfig): Promise<Scope[]>;

  /**
   * How data arrives: "api" connectors are synced on demand; "file" connectors
   * are fed exports the user uploads (see `parseImport`). Defaults to "api".
   */
  readonly ingestion?: "api" | "file";

  /**
   * Optional: decides ingestion per connector instance, for connectors that
   * can either sync or import depending on their config. Overrides `ingestion`.
   */
  ingestionFor?(config: TConfig): "api" | "file";

  /** Stream normalized cost records for the given date range. */
  syncCosts(config: TConfig, range: DateRange): AsyncGenerator<FocusRecord>;

  /** Optional: cost per group/team for the range (may overlap — see GroupCostRecord). */
  syncGroupCosts?(config: TConfig, range: DateRange): AsyncGenerator<GroupCostRecord>;

  /** Optional: daily per-user activity for the range, for ranking people without per-user dollars. */
  syncUserActivity?(config: TConfig, range: DateRange): AsyncGenerator<UserActivityRecord>;

  /** Optional: usage breakdowns for the range (see UsageMetricRecord), never added into spend. */
  syncMetrics?(config: TConfig, range: DateRange): AsyncGenerator<UsageMetricRecord>;

  /** Optional: current number of paid seats, used when the seat plan leaves seatCount unset. */
  getSeatCount?(config: TConfig): Promise<number | null>;

  /**
   * Required for "file" connectors: parse one uploaded export. `fileName` is
   * the uploaded file's name, for exports that carry their report type or
   * period only there.
   */
  parseImport?(config: TConfig, content: string, fileName?: string): ImportResult;
}

/**
 * Cost for one group/team over one period. Kept separate from FocusRecords
 * because a provider may count a member of several groups in full toward each,
 * so these rows don't partition the total.
 */
export interface GroupCostRecord {
  groupId: string | null;
  groupName?: string;
  chargePeriodStart: Date;
  chargePeriodEnd: Date;
  effectiveCost: number;
  billingCurrency: string;
}

/** One person's activity on one UTC day. */
export interface UserActivityRecord {
  date: Date;
  userId: string;
  userEmail?: string;
  userName?: string;
  messageCount: number;
  sessionCount: number;
}

/**
 * One person's usage over a whole report period, from leaderboard-style
 * exports. Kept apart from FocusRecords because the same spend is usually
 * already in the totals from another report, so adding it in would count it
 * twice.
 */
export interface UserUsageRecord {
  periodStart: Date;
  periodEnd: Date;
  userId: string;
  userEmail?: string;
  userName?: string;
  credits?: number;
  effectiveCost: number;
  billingCurrency: string;
  tokens?: number;
  linesOfCode?: number;
}

/**
 * One number for one period, broken down by one dimension (credits by model,
 * messages by product, …). A breakdown of totals reported elsewhere, so never
 * added into spend.
 */
export interface UsageMetricRecord {
  dimension: string;
  key: string;
  metric: string;
  periodStart: Date;
  periodEnd: Date;
  value: number;
  /** Dollar value of `value`, when it's a priced quantity such as credits. */
  effectiveCost?: number;
}

/** Everything one uploaded export contains, and the half-open range it covers. */
export interface ImportResult {
  /**
   * Which report this file is. An import replaces only earlier data from the
   * same dataset, so several reports covering the same dates can sit side by
   * side. Omitted, an import replaces everything the connector stored for the
   * range.
   */
  dataset?: { key: string; label: string };
  range: DateRange;
  costs: FocusRecord[];
  groupCosts: GroupCostRecord[];
  activity: UserActivityRecord[];
  userUsage?: UserUsageRecord[];
  metrics?: UsageMetricRecord[];
}

/** How one instance's data arrives, given its config. */
export function ingestionOf<TConfig>(connector: CostConnector<TConfig>, config: TConfig): "api" | "file" {
  return connector.ingestionFor?.(config) ?? connector.ingestion ?? "api";
}

export class ConnectorRegistry {
  private connectors = new Map<string, CostConnector<any>>();

  register(connector: CostConnector<any>): void {
    if (this.connectors.has(connector.provider)) {
      throw new Error(`Connector already registered for provider "${connector.provider}"`);
    }
    this.connectors.set(connector.provider, connector);
  }

  get(provider: string): CostConnector<any> {
    const connector = this.connectors.get(provider);
    if (!connector) {
      throw new Error(
        `No connector registered for provider "${provider}". Known providers: ${[...this.connectors.keys()].join(", ")}`,
      );
    }
    return connector;
  }

  list(): CostConnector<any>[] {
    return [...this.connectors.values()];
  }
}
