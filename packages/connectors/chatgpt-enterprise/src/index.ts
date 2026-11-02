import type {
  CostConnector,
  DateRange,
  GroupCostRecord,
  ImportResult,
  UsageMetricRecord,
  UserActivityRecord,
  UserUsageRecord,
} from "@cost-reporting/connector-core";
import type { FocusRecord } from "@cost-reporting/focus-schema";
import {
  dailyUsage,
  isAuthError,
  listGroups,
  listUsers,
  type AdminApiCredentials,
  type DailyUsageRow,
  type WorkspaceGroup,
} from "./adminApi.js";
import {
  groupCostRecords,
  unattributedCostRecords,
  usageMetrics,
  userActivityRecord,
  userCostRecords,
} from "./apiMapping.js";

/**
 * ChatGPT Enterprise/Business usage, in one of two modes picked by the config:
 * - API mode (`adminKey` + `workspaceId`): synced from the workspace Admin
 *   API's Daily Usage endpoint (see adminApi.ts and apiMapping.ts).
 * - CSV mode (no `adminKey`): the exports from the ChatGPT admin console.
 *
 * In CSV mode,
 * the console exports several reports, each its own file and each stored as
 * its own dataset (see `parseImport`):
 * - Analytics time series (analytics-credits-by-product, -overview-messages,
 *   …): one row per day, one column per product/model. Credits by product is
 *   the spend total; the rest are breakdowns of it or usage counts.
 * - Leaderboards (leaderboard-users, leaderboard-groups): one row per person
 *   or group for the whole period, whose dates are only in the file name.
 * - A per-user usage export with a date on each row, whose column names aren't
 *   publicly specified, so they're matched by common names (see COLUMNS).
 */
export interface ChatGptEnterpriseConnectorConfig {
  /** Label for this workspace in reports; defaults to "ChatGPT Enterprise". */
  workspaceName?: string;
  /**
   * USD per credit from your contract. In CSV mode, required when an export
   * reports credits rather than dollars. In API mode, optional: without it,
   * credits are valued at OpenAI's estimate, which uses the overage rate.
   */
  creditPriceUsd?: number;
  /**
   * API mode: a workspace-scoped Admin key (Admin Console > Credentials >
   * Admin keys) with Enterprise analytics API: Read. Users: Read adds the
   * seat count and Directory: Read adds cost by group; both are optional.
   */
  adminKey?: string;
  /** API mode: the ChatGPT workspace ID (a UUID). */
  workspaceId?: string;
}

const COLUMNS = {
  email: ["email", "user_email", "email_address", "user"],
  name: ["name", "user_name", "full_name", "display_name"],
  start: ["date", "day", "usage_date", "period_start", "start_date", "month"],
  end: ["period_end", "end_date"],
  costUsd: ["cost_usd", "cost", "usd", "amount_usd", "spend_usd", "spend"],
  credits: ["credits", "credits_used", "credit_usage", "credits_consumed"],
  product: ["product", "feature", "surface"],
  model: ["model", "model_name"],
  group: ["group", "group_name", "team"],
  messages: ["messages", "message_count", "messages_sent"],
} as const;

type Column = keyof typeof COLUMNS;

const DAY_MS = 86_400_000;

/** RFC 4180 CSV: quoted fields, escaped quotes, CRLF or LF line endings, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** "2026-10-05" is that day; "2026-10" is that month. Returns a half-open [start, end). */
function parsePeriod(raw: string, rowNumber: number): { start: Date; end: Date } {
  const v = raw.trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (day) {
    const start = new Date(Date.UTC(+day[1], +day[2] - 1, +day[3]));
    return { start, end: new Date(start.getTime() + DAY_MS) };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(v);
  if (month) {
    const start = new Date(Date.UTC(+month[1], +month[2] - 1, 1));
    return { start, end: new Date(Date.UTC(+month[1], +month[2], 1)) };
  }
  throw new Error(`Row ${rowNumber}: unrecognized date "${raw}" (expected YYYY-MM-DD or YYYY-MM)`);
}

function parseNumber(raw: string, column: string, rowNumber: number): number {
  const v = raw.trim().replace(/[$,]/g, "");
  if (v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Row ${rowNumber}: "${raw}" in ${column} is not a number`);
  return n;
}

export function parseExport(config: ChatGptEnterpriseConnectorConfig, content: string): ImportResult {
  const [header, ...body] = parseCsv(content);
  if (!header) throw new Error("The file is empty");

  const headers = header.map(normalizeHeader);
  const index = {} as Record<Column, number>;
  for (const [column, names] of Object.entries(COLUMNS) as Array<[Column, readonly string[]]>) {
    index[column] = headers.findIndex((h) => names.includes(h));
  }
  const missing: string[] = [];
  if (index.email < 0) missing.push(`a user email column (${COLUMNS.email.join(", ")})`);
  if (index.start < 0) missing.push(`a date column (${COLUMNS.start.join(", ")})`);
  if (index.costUsd < 0 && index.credits < 0) {
    missing.push(
      `a cost column (${COLUMNS.costUsd.join(", ")}) or credits column (${COLUMNS.credits.join(", ")})`,
    );
  }
  if (missing.length > 0) throw new Error(`The export is missing ${missing.join("; ")}`);
  if (index.costUsd < 0 && config.creditPriceUsd == null) {
    throw new Error(
      'This export reports credits, not dollars — set "creditPriceUsd" in the connector config',
    );
  }

  const accountId = config.workspaceName ?? "chatgpt-enterprise";
  const accountName = config.workspaceName ?? "ChatGPT Enterprise";
  const cell = (row: string[], column: Column) =>
    index[column] >= 0 ? (row[index[column]] ?? "").trim() : "";

  const costs = new Map<string, FocusRecord>();
  const groups = new Map<string, GroupCostRecord>();
  const activity = new Map<string, UserActivityRecord>();
  let rangeStart = Infinity;
  let rangeEnd = -Infinity;

  body.forEach((row, i) => {
    const rowNumber = i + 2; // 1-based, after the header
    const email = cell(row, "email").toLowerCase();
    if (!email) return;
    const period = parsePeriod(cell(row, "start"), rowNumber);
    if (index.end >= 0 && cell(row, "end")) {
      // An end date in an export is the last day covered, so the half-open end is the day after.
      period.end = new Date(parsePeriod(cell(row, "end"), rowNumber).start.getTime() + DAY_MS);
    }
    rangeStart = Math.min(rangeStart, period.start.getTime());
    rangeEnd = Math.max(rangeEnd, period.end.getTime());

    const cost =
      index.costUsd >= 0
        ? parseNumber(cell(row, "costUsd"), header[index.costUsd], rowNumber)
        : parseNumber(cell(row, "credits"), header[index.credits], rowNumber) * (config.creditPriceUsd ?? 0);
    const product = cell(row, "product") || "ChatGPT";
    const model = cell(row, "model") || undefined;
    const name = cell(row, "name") || undefined;

    if (cost !== 0) {
      const key = [email, product, model ?? "", period.start.toISOString(), period.end.toISOString()].join(
        "|",
      );
      const existing = costs.get(key);
      if (existing) {
        existing.BilledCost += cost;
        existing.EffectiveCost += cost;
      } else {
        costs.set(key, {
          BilledCost: cost,
          EffectiveCost: cost,
          BillingCurrency: "USD",
          ChargePeriodStart: period.start,
          ChargePeriodEnd: period.end,
          BillingPeriodStart: new Date(
            Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth(), 1),
          ),
          BillingPeriodEnd: new Date(
            Date.UTC(period.start.getUTCFullYear(), period.start.getUTCMonth() + 1, 1),
          ),
          ProviderName: "OpenAI",
          BillingAccountId: accountId,
          BillingAccountName: accountName,
          ServiceCategory: "AI and Machine Learning",
          ServiceName: product,
          ChargeCategory: "Usage",
          ChargeDescription: model,
          Tags: {},
          x_UserId: email,
          x_UserEmail: email,
          x_UserName: name,
        });
      }

      if (index.group >= 0) {
        const group = cell(row, "group") || null;
        const gKey = [group ?? "", period.start.toISOString(), period.end.toISOString()].join("|");
        const g = groups.get(gKey);
        if (g) g.effectiveCost += cost;
        else {
          groups.set(gKey, {
            groupId: group,
            groupName: group ?? undefined,
            chargePeriodStart: period.start,
            chargePeriodEnd: period.end,
            effectiveCost: cost,
            billingCurrency: "USD",
          });
        }
      }
    }

    if (index.messages >= 0) {
      const messages = parseNumber(cell(row, "messages"), header[index.messages], rowNumber);
      if (messages > 0) {
        const aKey = `${email}|${period.start.toISOString()}`;
        const a = activity.get(aKey);
        if (a) a.messageCount += messages;
        else {
          activity.set(aKey, {
            date: period.start,
            userId: email,
            userEmail: email,
            userName: name,
            messageCount: messages,
            sessionCount: 0,
          });
        }
      }
    }
  });

  if (!Number.isFinite(rangeStart)) throw new Error("The export has no rows with a user email");
  return {
    dataset: { key: "usage", label: "Usage by user" },
    range: { start: new Date(rangeStart), end: new Date(rangeEnd) },
    costs: [...costs.values()],
    groupCosts: [...groups.values()],
    activity: [...activity.values()],
  };
}

/**
 * Analytics time series, told apart by file name since several share the same
 * columns (Start Time, End Time, then one column per product or model).
 * `costs` marks the one stored as spend; the rest are breakdowns or counts.
 */
const TIME_SERIES = [
  {
    pattern: /analytics-(credits-by-product|overview-credits)/,
    key: "credits-by-product",
    label: "Credits by product",
    dimension: "product",
    metric: "credits",
    costs: true,
  },
  {
    pattern: /analytics-credits-by-model/,
    key: "credits-by-model",
    label: "Credits by model",
    dimension: "model",
    metric: "credits",
  },
  {
    pattern: /analytics-credits-by-metered-item/,
    key: "credits-by-metered-item",
    label: "Credits by metered item",
    dimension: "metered_item",
    metric: "credits",
  },
  {
    pattern: /analytics-overview-messages/,
    key: "messages",
    label: "Messages by product",
    dimension: "product",
    metric: "messages",
  },
  {
    pattern: /analytics-overview-active-users/,
    key: "active-users",
    label: "Active users by product",
    dimension: "product",
    metric: "active_users",
  },
  {
    pattern: /analytics-overview-tokens/,
    key: "tokens",
    label: "Tokens by product",
    dimension: "product",
    metric: "tokens",
  },
] as const;

type TimeSeriesReport = (typeof TIME_SERIES)[number];

function utcDay(raw: string, what: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) throw new Error(`Unrecognized date "${raw}" in ${what} (expected YYYY-MM-DD)`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/** "…_2026-10-23-to-2026-10-29.csv" covers 23–29 October, so [23rd, 30th). */
function periodFromFileName(fileName: string | undefined): { start: Date; end: Date } {
  const m = /(\d{4}-\d{2}-\d{2})-to-(\d{4}-\d{2}-\d{2})/.exec(fileName ?? "");
  if (!m) {
    throw new Error(
      "Leaderboard exports carry their dates only in the file name (…_2026-10-23-to-2026-10-29.csv) — upload the file without renaming it",
    );
  }
  return {
    start: utcDay(m[1], "the file name"),
    end: new Date(utcDay(m[2], "the file name").getTime() + DAY_MS),
  };
}

function billingMonth(start: Date) {
  return {
    BillingPeriodStart: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)),
    BillingPeriodEnd: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
  };
}

function creditPrice(config: ChatGptEnterpriseConnectorConfig, report: string): number {
  if (config.creditPriceUsd == null) {
    throw new Error(
      `${report} reports credits, not dollars — set "creditPriceUsd" in the connector config (your contract's USD per credit)`,
    );
  }
  return config.creditPriceUsd;
}

/** Looks up a column by its normalized name, trying each alias in turn. */
function columnFinder(headers: string[]) {
  return (...names: string[]) => {
    for (const name of names) {
      const i = headers.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
}

function parseTimeSeries(
  config: ChatGptEnterpriseConnectorConfig,
  report: TimeSeriesReport,
  header: string[],
  body: string[][],
): ImportResult {
  const headers = header.map(normalizeHeader);
  const startIdx = headers.indexOf("start_time");
  const endIdx = headers.indexOf("end_time");
  const series = header
    .map((name, i) => ({ name: name.trim(), i }))
    .filter(({ i }) => i !== startIdx && i !== endIdx);
  // Spend needs a price; other credit breakdowns are still useful as credits without one.
  const price =
    "costs" in report
      ? creditPrice(config, report.label)
      : report.metric === "credits"
        ? config.creditPriceUsd
        : undefined;
  const accountId = config.workspaceName ?? "chatgpt-enterprise";
  const accountName = config.workspaceName ?? "ChatGPT Enterprise";

  const costs: FocusRecord[] = [];
  const metrics: UsageMetricRecord[] = [];
  let rangeStart = Infinity;
  let rangeEnd = -Infinity;
  body.forEach((row, i) => {
    const rowNumber = i + 2;
    const start = utcDay(row[startIdx] ?? "", `row ${rowNumber}`);
    const end = utcDay(row[endIdx] ?? "", `row ${rowNumber}`);
    if (end <= start) throw new Error(`Row ${rowNumber}: End Time is not after Start Time`);
    rangeStart = Math.min(rangeStart, start.getTime());
    rangeEnd = Math.max(rangeEnd, end.getTime());
    for (const { name, i: col } of series) {
      const value = parseNumber(row[col] ?? "", name, rowNumber);
      if (value === 0) continue;
      const cost = price == null ? undefined : value * price;
      if ("costs" in report && cost != null) {
        costs.push({
          BilledCost: cost,
          EffectiveCost: cost,
          BillingCurrency: "USD",
          ChargePeriodStart: start,
          ChargePeriodEnd: end,
          ...billingMonth(start),
          ProviderName: "OpenAI",
          BillingAccountId: accountId,
          BillingAccountName: accountName,
          ServiceCategory: "AI and Machine Learning",
          ServiceName: name,
          ChargeCategory: "Usage",
          ChargeDescription: `${value.toFixed(2)} credits`,
          PricingQuantity: value,
          PricingUnit: "credits",
          Tags: {},
        });
      } else {
        metrics.push({
          dimension: report.dimension,
          key: name,
          metric: report.metric,
          periodStart: start,
          periodEnd: end,
          value,
          effectiveCost: cost,
        });
      }
    }
  });

  if (!Number.isFinite(rangeStart)) throw new Error("The export has no data rows");
  return {
    dataset: { key: report.key, label: report.label },
    range: { start: new Date(rangeStart), end: new Date(rangeEnd) },
    costs,
    groupCosts: [],
    activity: [],
    metrics,
  };
}

/** Cost of one leaderboard row: the export's dollar estimate, else credits × price. */
function leaderboardCost(
  config: ChatGptEnterpriseConnectorConfig,
  row: string[],
  header: string[],
  col: { credits: number; cost: number },
  rowNumber: number,
): { credits?: number; cost: number } {
  const credits =
    col.credits >= 0 ? parseNumber(row[col.credits] ?? "", header[col.credits], rowNumber) : undefined;
  if (col.cost >= 0) return { credits, cost: parseNumber(row[col.cost] ?? "", header[col.cost], rowNumber) };
  if (credits == null) throw new Error("The leaderboard has neither an Estimated costs nor a Credits column");
  return { credits, cost: credits * creditPrice(config, "This leaderboard") };
}

function parseUserLeaderboard(
  config: ChatGptEnterpriseConnectorConfig,
  header: string[],
  body: string[][],
  fileName: string | undefined,
): ImportResult {
  const period = periodFromFileName(fileName);
  const find = columnFinder(header.map(normalizeHeader));
  const col = {
    email: find("email", "user_email"),
    userId: find("user_id"),
    name: find("name", "user_name"),
    credits: find("credits"),
    cost: find("estimated_costs", "estimated_cost", "cost_usd", "cost"),
    currency: find("estimated_cost_currency", "currency"),
    tokens: find("tokens"),
    linesOfCode: find("lines_of_code"),
  };

  const userUsage: UserUsageRecord[] = [];
  body.forEach((row, i) => {
    const rowNumber = i + 2;
    const cell = (c: number) => (c >= 0 ? (row[c] ?? "").trim() : "");
    const email = cell(col.email).toLowerCase();
    // Keyed by email, like the per-user usage export, so a person is one person across reports.
    const userId = email || cell(col.userId);
    if (!userId) return;
    const { credits, cost } = leaderboardCost(config, row, header, col, rowNumber);
    userUsage.push({
      periodStart: period.start,
      periodEnd: period.end,
      userId,
      userEmail: email || undefined,
      userName: cell(col.name) || undefined,
      credits,
      effectiveCost: cost,
      billingCurrency: cell(col.currency) || "USD",
      tokens: col.tokens >= 0 ? parseNumber(cell(col.tokens), header[col.tokens], rowNumber) : undefined,
      linesOfCode:
        col.linesOfCode >= 0
          ? parseNumber(cell(col.linesOfCode), header[col.linesOfCode], rowNumber)
          : undefined,
    });
  });

  if (userUsage.length === 0) throw new Error("The leaderboard has no rows with a user");
  return {
    dataset: { key: "leaderboard-users", label: "People leaderboard" },
    range: period,
    costs: [],
    groupCosts: [],
    activity: [],
    userUsage,
  };
}

function parseGroupLeaderboard(
  config: ChatGptEnterpriseConnectorConfig,
  header: string[],
  body: string[][],
  fileName: string | undefined,
): ImportResult {
  const period = periodFromFileName(fileName);
  const find = columnFinder(header.map(normalizeHeader));
  const col = {
    groupId: find("group_id"),
    name: find("name", "group_name"),
    credits: find("credits"),
    cost: find("estimated_costs", "estimated_cost", "cost_usd", "cost"),
    currency: find("estimated_cost_currency", "currency"),
  };

  const groupCosts: GroupCostRecord[] = [];
  body.forEach((row, i) => {
    const rowNumber = i + 2;
    const groupId = (row[col.groupId] ?? "").trim();
    const name = col.name >= 0 ? (row[col.name] ?? "").trim() : "";
    if (!groupId && !name) return;
    groupCosts.push({
      groupId: groupId || name,
      groupName: name || undefined,
      chargePeriodStart: period.start,
      chargePeriodEnd: period.end,
      effectiveCost: leaderboardCost(config, row, header, col, rowNumber).cost,
      billingCurrency: (col.currency >= 0 && row[col.currency]?.trim()) || "USD",
    });
  });

  if (groupCosts.length === 0) throw new Error("The leaderboard has no rows with a group");
  return {
    dataset: { key: "leaderboard-groups", label: "Groups leaderboard" },
    range: period,
    costs: [],
    groupCosts,
    activity: [],
  };
}

/**
 * Parses any of the admin console's exports, working out which report it is
 * from its columns and, for the analytics time series that share columns,
 * its file name.
 */
export function parseImport(
  config: ChatGptEnterpriseConnectorConfig,
  content: string,
  fileName?: string,
): ImportResult {
  const [header, ...body] = parseCsv(content);
  if (!header) throw new Error("The file is empty");
  const headers = header.map(normalizeHeader);
  const has = (name: string) => headers.includes(name);

  if (has("rank") && (has("email") || has("user_id"))) {
    return parseUserLeaderboard(config, header, body, fileName);
  }
  if (has("rank") && has("group_id")) return parseGroupLeaderboard(config, header, body, fileName);
  if (has("start_time") && has("end_time")) {
    const name = (fileName ?? "").toLowerCase();
    const report = TIME_SERIES.find((r) => r.pattern.test(name));
    if (!report) {
      throw new Error(
        `Can't tell which analytics report this is from its file name "${fileName ?? ""}". Upload it under the name the admin console gave it (analytics-credits-by-product_…, analytics-overview-messages_…, …)`,
      );
    }
    return parseTimeSeries(config, report, header, body);
  }
  return parseExport(config, content);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function apiCredentials(config: ChatGptEnterpriseConnectorConfig): AdminApiCredentials {
  if (!config.adminKey || !config.workspaceId) {
    throw new Error('API mode needs both "adminKey" and "workspaceId" in the connector config');
  }
  return { adminKey: config.adminKey, workspaceId: config.workspaceId };
}

async function collectRows(source: AsyncGenerator<DailyUsageRow>): Promise<DailyUsageRow[]> {
  const rows: DailyUsageRow[] = [];
  for await (const row of source) rows.push(row);
  return rows;
}

/**
 * Costs, activity and metrics are each built from the same Daily Usage rows,
 * and a sync asks for all three at once with the same config object, so the
 * fetch is shared per config and range instead of made three times.
 */
const usageCache = new WeakMap<
  ChatGptEnterpriseConnectorConfig,
  Map<string, Promise<{ users: DailyUsageRow[]; workspace: DailyUsageRow[] }>>
>();

function loadUsage(config: ChatGptEnterpriseConnectorConfig, range: DateRange) {
  let byRange = usageCache.get(config);
  if (!byRange) usageCache.set(config, (byRange = new Map()));
  const key = `${range.start.toISOString()}|${range.end.toISOString()}`;
  let usage = byRange.get(key);
  if (!usage) {
    const creds = apiCredentials(config);
    usage = Promise.all([
      collectRows(dailyUsage(creds, range)),
      collectRows(dailyUsage(creds, range, { workspace: true })),
    ]).then(([users, workspace]) => ({ users, workspace }));
    byRange.set(key, usage);
    // A failed fetch shouldn't be served to a retry.
    usage.catch(() => byRange.delete(key));
  }
  return usage;
}

export const chatGptEnterpriseConnector: CostConnector<ChatGptEnterpriseConnectorConfig> = {
  provider: "OpenAI",
  displayName: "ChatGPT Enterprise",

  ingestionFor(config) {
    return config.adminKey ? "api" : "file";
  },

  async validateCredentials(config) {
    if (
      config.creditPriceUsd != null &&
      !(typeof config.creditPriceUsd === "number" && config.creditPriceUsd > 0)
    ) {
      return false;
    }
    if (!config.adminKey) return true;
    if (typeof config.workspaceId !== "string" || !UUID.test(config.workspaceId)) {
      throw new Error('"workspaceId" must be the ChatGPT workspace ID, a UUID');
    }
    // One workspace-wide day is the cheapest call the analytics permission allows.
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    try {
      const rows = dailyUsage(
        apiCredentials(config),
        {
          start: new Date(today - DAY_MS),
          end: new Date(today),
        },
        { workspace: true },
      );
      await rows.next();
      return true;
    } catch (err) {
      if (isAuthError(err)) return false;
      throw err;
    }
  },

  async listScopes(config) {
    return [
      {
        id: config.workspaceName ?? "chatgpt-enterprise",
        name: config.workspaceName ?? "ChatGPT Enterprise",
        type: "workspace",
      },
    ];
  },

  // Per person, day and client, plus each day's usage by people no longer in
  // the workspace, so totals match the workspace's.
  async *syncCosts(config, range) {
    if (!config.adminKey) {
      throw new Error("This ChatGPT connector is updated by importing admin console exports, not by syncing");
    }
    const { users, workspace } = await loadUsage(config, range);
    for (const row of users) yield* userCostRecords(row, config);
    yield* unattributedCostRecords(workspace, users, config);
  },

  async *syncUserActivity(config, range) {
    if (!config.adminKey) return;
    const { users } = await loadUsage(config, range);
    for (const row of users) {
      const record = userActivityRecord(row);
      if (record) yield record;
    }
  },

  async *syncMetrics(config, range) {
    if (!config.adminKey) return;
    const { users, workspace } = await loadUsage(config, range);
    yield* usageMetrics(workspace, users, config);
  },

  // Cost per group is its current members' usage: the API filters by today's
  // membership, so someone who changed groups counts toward the new one, and a
  // member of several groups counts toward each. Needs Directory: Read;
  // without it, groups are skipped.
  async *syncGroupCosts(config, range) {
    if (!config.adminKey) return;
    const creds = apiCredentials(config);
    const groups: WorkspaceGroup[] = [];
    try {
      for await (const group of listGroups(creds)) groups.push(group);
    } catch (err) {
      if (isAuthError(err)) return;
      throw err;
    }
    for (const group of groups) {
      const rows = await collectRows(dailyUsage(creds, range, { workspace: true, groupId: group.id }));
      yield* groupCostRecords(group, rows, config);
    }
  },

  // ChatGPT seats among current members (Codex-only seats aren't counted).
  // Needs Users: Read; without it, the seat plan needs its seat count entered.
  async getSeatCount(config) {
    if (!config.adminKey) return null;
    let seats = 0;
    try {
      for await (const user of listUsers(apiCredentials(config))) {
        if (user.seat_type !== "codex") seats++;
      }
    } catch (err) {
      if (isAuthError(err)) return null;
      throw err;
    }
    return seats;
  },

  parseImport,
};

export default chatGptEnterpriseConnector;
