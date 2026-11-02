import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { dailyUsage, isAuthError, listUsers } from "../src/adminApi.js";
import { chatGptEnterpriseConnector } from "../src/index.js";

const creds = { adminKey: "sk-admin-test", workspaceId: "11111111-2222-3333-4444-555555555555" };
const range = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-03T00:00:00Z") };
const realFetch = globalThis.fetch;

/** Replaces fetch with canned responses, recording each requested URL. */
function stubFetch(responses: Array<() => Response>): URL[] {
  const urls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(new URL(String(input)));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer sk-admin-test");
    const next = responses.shift();
    assert.ok(next, "unexpected extra request");
    return next();
  }) as typeof fetch;
  return urls;
}

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function collect<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

describe("dailyUsage", () => {
  it("sends whole-day Unix bounds and follows next_page", async () => {
    const urls = stubFetch([
      json({ data: [{ start_time: 1, end_time: 2, totals: {} }], has_more: true, next_page: "p2" }),
      json({ data: [{ start_time: 2, end_time: 3, totals: {} }], has_more: false, next_page: null }),
    ]);
    const rows = await collect(dailyUsage(creds, range, { workspace: true, groupId: "g1" }));
    assert.equal(rows.length, 2);
    assert.equal(
      urls[0].origin + urls[0].pathname,
      `https://api.chatgpt.com/v1/analytics/workspaces/${creds.workspaceId}/usage`,
    );
    assert.equal(urls[0].searchParams.get("start_time"), String(Date.UTC(2026, 9, 1) / 1000));
    assert.equal(urls[0].searchParams.get("end_time"), String(Date.UTC(2026, 9, 3) / 1000));
    assert.equal(urls[0].searchParams.get("group"), "workspace");
    assert.equal(urls[0].searchParams.get("group_ids"), "g1");
    assert.equal(urls[0].searchParams.get("page"), null);
    assert.equal(urls[1].searchParams.get("page"), "p2");
  });

  it("retries a 429 after Retry-After", async () => {
    stubFetch([
      json({ error: "slow down" }, 429, { "retry-after": "0" }),
      json({ data: [], has_more: false, next_page: null }),
    ]);
    assert.deepEqual(await collect(dailyUsage(creds, range)), []);
  });

  it("reports a 403 as an auth error", async () => {
    stubFetch([json({ error: "forbidden" }, 403)]);
    await assert.rejects(collect(dailyUsage(creds, range)), (err) => isAuthError(err));
  });
});

describe("listUsers", () => {
  it("pages with after=last_id", async () => {
    const urls = stubFetch([
      json({ data: [{ id: "u1" }], has_more: true, last_id: "u1" }),
      json({ data: [{ id: "u2" }], has_more: false, last_id: "u2" }),
    ]);
    assert.deepEqual(
      (await collect(listUsers(creds))).map((u) => u.id),
      ["u1", "u2"],
    );
    assert.equal(urls[1].searchParams.get("after"), "u1");
  });
});

describe("chatGptEnterpriseConnector", () => {
  it("syncs with an admin key and imports without one", () => {
    assert.equal(
      chatGptEnterpriseConnector.ingestionFor?.({ adminKey: "k", workspaceId: creds.workspaceId }),
      "api",
    );
    assert.equal(chatGptEnterpriseConnector.ingestionFor?.({ workspaceName: "Acme" }), "file");
  });

  it("validates the key against the API", async () => {
    stubFetch([json({ data: [], has_more: false, next_page: null })]);
    assert.equal(await chatGptEnterpriseConnector.validateCredentials({ ...creds }), true);
    stubFetch([json({ error: "bad key" }, 401)]);
    assert.equal(await chatGptEnterpriseConnector.validateCredentials({ ...creds }), false);
  });

  it("rejects a workspace ID that isn't a UUID before calling the API", async () => {
    stubFetch([]);
    await assert.rejects(
      chatGptEnterpriseConnector.validateCredentials({ adminKey: "k", workspaceId: "acme" }),
      /UUID/,
    );
  });

  it("counts ChatGPT seats, and gives up quietly without the Users permission", async () => {
    stubFetch([
      json({
        data: [{ id: "u1", seat_type: "chatgpt" }, { id: "u2", seat_type: "codex" }, { id: "u3" }],
        has_more: false,
        last_id: "u3",
      }),
    ]);
    assert.equal(await chatGptEnterpriseConnector.getSeatCount?.({ ...creds }), 2);
    stubFetch([json({ error: "forbidden" }, 403)]);
    assert.equal(await chatGptEnterpriseConnector.getSeatCount?.({ ...creds }), null);
  });
});
