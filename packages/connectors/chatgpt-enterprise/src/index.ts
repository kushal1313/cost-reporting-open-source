import type {
  CostConnector,
  GroupCostRecord,
  ImportResult,
  UserActivityRecord,
} from "@cost-reporting/connector-core";
import type { FocusRecord } from "@cost-reporting/focus-schema";

/**
 * ChatGPT Enterprise/Business per-user usage, from the CSV export in the
 * ChatGPT admin console (Usage > Export > by user). OpenAI's Cost API for
 * workspace credits has no public reference yet; when it does, an API mode can
 * produce the same records and nothing downstream changes.
 *
 * The export's column names aren't publicly specified, so columns are matched
 * by common names (see COLUMNS) and an export missing a required one is
 * rejected with the list of names accepted.
 */
export interface ChatGptEnterpriseConnectorConfig {
  /** Label for this workspace in reports; defaults to "ChatGPT Enterprise". */
  workspaceName?: string;
  /** USD per credit from your contract. Required when the export reports credits rather than dollars. */
  creditPriceUsd?: number;
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
    range: { start: new Date(rangeStart), end: new Date(rangeEnd) },
    costs: [...costs.values()],
    groupCosts: [...groups.values()],
    activity: [...activity.values()],
  };
}

export const chatGptEnterpriseConnector: CostConnector<ChatGptEnterpriseConnectorConfig> = {
  provider: "OpenAI",
  displayName: "ChatGPT Enterprise",
  ingestion: "file",

  async validateCredentials(config) {
    return (
      config.creditPriceUsd == null ||
      (typeof config.creditPriceUsd === "number" && config.creditPriceUsd > 0)
    );
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

  // eslint-disable-next-line require-yield
  async *syncCosts() {
    throw new Error("ChatGPT Enterprise is updated by importing the admin console export, not by syncing");
  },

  parseImport: parseExport,
};

export default chatGptEnterpriseConnector;
