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

  /** Stream normalized cost records for the given date range. */
  syncCosts(config: TConfig, range: DateRange): AsyncGenerator<FocusRecord>;

  /** Optional: cost per group/team for the range (may overlap — see GroupCostRecord). */
  syncGroupCosts?(config: TConfig, range: DateRange): AsyncGenerator<GroupCostRecord>;

  /** Optional: daily per-user activity for the range, for ranking people without per-user dollars. */
  syncUserActivity?(config: TConfig, range: DateRange): AsyncGenerator<UserActivityRecord>;

  /** Optional: current number of paid seats, used when the seat plan leaves seatCount unset. */
  getSeatCount?(config: TConfig): Promise<number | null>;

  /** Required for "file" connectors: parse one uploaded export. */
  parseImport?(config: TConfig, content: string): ImportResult;
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

/** Everything one uploaded export contains, and the half-open range it covers. */
export interface ImportResult {
  range: DateRange;
  costs: FocusRecord[];
  groupCosts: GroupCostRecord[];
  activity: UserActivityRecord[];
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
