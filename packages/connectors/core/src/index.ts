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

  /** Stream normalized cost records for the given date range. */
  syncCosts(config: TConfig, range: DateRange): AsyncGenerator<FocusRecord>;
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
