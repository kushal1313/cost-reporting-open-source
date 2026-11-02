import type { DateRange } from "@cost-reporting/connector-core";

/**
 * Thin client for the ChatGPT workspace Admin API — the only file that knows
 * its routes. Reference: https://chatgpt.com/public/admin/api-reference
 *
 * The base URL is fixed: nothing in a connector's config can redirect the
 * admin key to another host.
 */
const BASE_URL = "https://api.chatgpt.com/v1";
const MAX_RETRIES = 5;
const USAGE_PAGE_SIZE = 30_000; // the Daily Usage maximum
const USERS_PAGE_SIZE = 1000;
const GROUPS_PAGE_SIZE = 100;

export interface AdminApiCredentials {
  adminKey: string;
  workspaceId: string;
}

/** Credits-priced and USD-priced amounts; either can be null (see `toUsd`). */
export interface UsageAmounts {
  credits?: number | null;
  cost_usd?: number | null;
  estimated_cost_usd?: number | null;
}

export interface UsageTotals extends UsageAmounts {
  chats?: number | null;
  messages?: number | null;
  text_total_tokens?: number | null;
}

export interface UsageClient extends UsageTotals {
  client_id: string | null;
}

export interface UsageModel extends UsageAmounts {
  model: string | null;
  speed?: "standard" | "fast" | null;
}

/** One row of Get Daily Usage: one user (or the whole workspace) for one UTC day. */
export interface DailyUsageRow {
  start_time: number;
  end_time: number;
  user_id?: string | null;
  actor?: { type: string; user_id?: string | null; email?: string | null } | null;
  totals: UsageTotals;
  clients?: UsageClient[] | null;
  models?: UsageModel[] | null;
}

export interface WorkspaceUser {
  id: string;
  email?: string | null;
  name?: string | null;
  seat_type?: "chatgpt" | "codex" | null;
}

export interface WorkspaceGroup {
  id: string;
  name?: string | null;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

/** 401/403: the key is wrong, or lacks the permission an endpoint needs. */
export function isAuthError(err: unknown): boolean {
  return err instanceof AdminApiError && (err.status === 401 || err.status === 403);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const seconds = header == null ? NaN : Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = header == null ? NaN : Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return 1000 * 2 ** attempt;
}

/** GET with the admin key, retrying 429s and transient 5xx responses (honouring Retry-After). */
async function get<T>(creds: AdminApiCredentials, path: string, query: URLSearchParams): Promise<T> {
  const url = `${BASE_URL}${path}?${query}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${creds.adminKey}` } });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status === 500 || res.status === 503;
    if (retryable && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(res, attempt));
      continue;
    }
    const body = (await res.text()).slice(0, 500);
    throw new AdminApiError(res.status, `ChatGPT Admin API ${path} returned ${res.status}: ${body}`);
  }
}

const workspace = (creds: AdminApiCredentials) => encodeURIComponent(creds.workspaceId);
const unixSeconds = (d: Date) => Math.floor(d.getTime() / 1000);

/**
 * Get Daily Usage for [range.start, range.end), whole UTC days. Per-user rows
 * by default; `workspace: true` returns one workspace-wide row per day, which
 * also counts users deleted since. `groupId` limits it to that group's
 * current members.
 */
export async function* dailyUsage(
  creds: AdminApiCredentials,
  range: DateRange,
  opts: { workspace?: boolean; groupId?: string } = {},
): AsyncGenerator<DailyUsageRow> {
  let page: string | null = null;
  do {
    const query = new URLSearchParams({
      start_time: String(unixSeconds(range.start)),
      end_time: String(unixSeconds(range.end)),
      limit: String(USAGE_PAGE_SIZE),
    });
    if (opts.workspace) query.set("group", "workspace");
    if (opts.groupId) query.append("group_ids", opts.groupId);
    if (page) query.set("page", page);
    const res: { data: DailyUsageRow[]; has_more: boolean; next_page: string | null } = await get(
      creds,
      `/analytics/workspaces/${workspace(creds)}/usage`,
      query,
    );
    yield* res.data;
    page = res.has_more ? res.next_page : null;
  } while (page);
}

/** List Workspace Users: current active members (needs the Users read permission). */
export async function* listUsers(creds: AdminApiCredentials): AsyncGenerator<WorkspaceUser> {
  let after: string | null = null;
  do {
    const query = new URLSearchParams({ limit: String(USERS_PAGE_SIZE) });
    if (after) query.set("after", after);
    const res: { data: WorkspaceUser[]; has_more: boolean; last_id: string | null } = await get(
      creds,
      `/manage/workspaces/${workspace(creds)}/users`,
      query,
    );
    yield* res.data;
    after = res.has_more ? res.last_id : null;
  } while (after);
}

/** List Groups, manual and SCIM (needs the Directory read permission). */
export async function* listGroups(creds: AdminApiCredentials): AsyncGenerator<WorkspaceGroup> {
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: String(GROUPS_PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const res: { data: WorkspaceGroup[]; has_more: boolean; cursor: string | null } = await get(
      creds,
      `/manage/workspaces/${workspace(creds)}/groups`,
      query,
    );
    yield* res.data;
    cursor = res.has_more ? res.cursor : null;
  } while (cursor);
}
