import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DailyUsageRow } from "../src/adminApi.js";
import {
  groupCostRecords,
  toUsd,
  unattributedCostRecords,
  usageMetrics,
  userActivityRecord,
  userCostRecords,
} from "../src/apiMapping.js";

// 2026-10-05T00:00:00Z and the day after, in Unix seconds.
const DAY = 1791158400;
const NEXT_DAY = DAY + 86_400;

function row(overrides: Partial<DailyUsageRow>): DailyUsageRow {
  return { start_time: DAY, end_time: NEXT_DAY, totals: {}, ...overrides };
}

const alex = { type: "ACCOUNT_USER", user_id: "user-1", email: "Alex@Example.com" };

describe("toUsd", () => {
  it("values credits at the contract price", () => {
    assert.equal(toUsd({ credits: 100, estimated_cost_usd: 5 }, 0.04), 4);
  });
  it("falls back to OpenAI's estimate without a contract price", () => {
    assert.equal(toUsd({ credits: 100, estimated_cost_usd: 5 }), 5);
  });
  it("takes native USD as is and never mixes it with credits", () => {
    assert.equal(toUsd({ cost_usd: 2.5, credits: null }), 2.5);
    assert.equal(toUsd({ cost_usd: 2.5, credits: 100, estimated_cost_usd: 5 }, 0.04), 6.5);
  });
});

describe("userCostRecords", () => {
  it("splits a person-day by client and books the unattributed rest as Other", () => {
    const records = userCostRecords(
      row({
        actor: alex,
        totals: { credits: 100 },
        clients: [
          { client_id: "web", credits: 60 },
          { client_id: "codex_cli", credits: 30 },
        ],
      }),
      { creditPriceUsd: 0.04 },
    );
    assert.deepEqual(
      records.map((r) => [r.ServiceName, Number(r.EffectiveCost.toFixed(6))]),
      [
        ["web", 2.4],
        ["codex_cli", 1.2],
        ["Other", 0.4],
      ],
    );
    assert.ok(records.every((r) => r.x_UserId === "alex@example.com" && r.ProviderName === "OpenAI"));
    assert.equal(records[0].ChargePeriodStart.toISOString(), "2026-10-05T00:00:00.000Z");
    assert.equal(records[0].BillingPeriodStart.toISOString(), "2026-10-01T00:00:00.000Z");
  });

  it("books the total as one line when the client breakdown exceeds it", () => {
    const records = userCostRecords(
      row({ actor: alex, totals: { cost_usd: 1 }, clients: [{ client_id: "web", cost_usd: 3 }] }),
      {},
    );
    assert.deepEqual(
      records.map((r) => [r.ServiceName, r.EffectiveCost]),
      [["ChatGPT", 1]],
    );
  });

  it("skips rows with no cost or no identifiable user", () => {
    assert.deepEqual(userCostRecords(row({ actor: alex, totals: { credits: 0 } }), {}), []);
    assert.deepEqual(userCostRecords(row({ totals: { cost_usd: 1 } }), {}), []);
  });
});

describe("unattributedCostRecords", () => {
  it("books each day's workspace total minus its users' as unattributed", () => {
    const users = [row({ actor: alex, totals: { cost_usd: 3 } })];
    const workspace = [
      row({ totals: { cost_usd: 5 } }),
      row({ start_time: NEXT_DAY, end_time: NEXT_DAY + 86_400, totals: { cost_usd: 0 } }),
    ];
    const records = unattributedCostRecords(workspace, users, {});
    assert.equal(records.length, 1);
    assert.equal(records[0].EffectiveCost, 2);
    assert.equal(records[0].x_UserId, undefined);
  });
});

describe("userActivityRecord", () => {
  it("maps messages and chats, and drops empty days", () => {
    assert.deepEqual(userActivityRecord(row({ actor: alex, totals: { messages: 12, chats: 3 } })), {
      date: new Date(DAY * 1000),
      userId: "alex@example.com",
      userEmail: "alex@example.com",
      messageCount: 12,
      sessionCount: 3,
    });
    assert.equal(userActivityRecord(row({ actor: alex, totals: { messages: 0, chats: 0 } })), null);
  });
});

describe("usageMetrics", () => {
  it("prices models, counts messages and tokens per client, and counts daily active users", () => {
    const workspace = [
      row({
        models: [
          { model: "gpt-6", speed: "fast", credits: 50 },
          { model: "gpt-6-mini", cost_usd: 1.5 },
        ],
        clients: [{ client_id: "web", messages: 40, text_total_tokens: 9000 }],
      }),
    ];
    const users = [
      row({ actor: alex, clients: [{ client_id: "web", messages: 30 }] }),
      row({
        actor: { type: "ACCOUNT_USER", email: "sam@example.com" },
        clients: [{ client_id: "web", messages: 10 }],
      }),
    ];
    const metrics = usageMetrics(workspace, users, { creditPriceUsd: 0.04 });
    const pick = (dimension: string, metric: string) =>
      metrics
        .filter((m) => m.dimension === dimension && m.metric === metric)
        .map((m) => [m.key, m.value, m.effectiveCost]);
    assert.deepEqual(pick("model", "credits"), [["gpt-6 (fast)", 50, 2]]);
    assert.deepEqual(pick("model", "cost_usd"), [["gpt-6-mini", 1.5, 1.5]]);
    assert.deepEqual(pick("product", "messages"), [["web", 40, undefined]]);
    assert.deepEqual(pick("product", "tokens"), [["web", 9000, undefined]]);
    assert.deepEqual(pick("product", "active_users"), [["web", 2, undefined]]);
  });
});

describe("groupCostRecords", () => {
  it("maps a group's daily totals", () => {
    const records = groupCostRecords({ id: "g1", name: "Platform" }, [row({ totals: { credits: 25 } })], {
      creditPriceUsd: 0.04,
    });
    assert.deepEqual(records, [
      {
        groupId: "g1",
        groupName: "Platform",
        chargePeriodStart: new Date(DAY * 1000),
        chargePeriodEnd: new Date(NEXT_DAY * 1000),
        effectiveCost: 1,
        billingCurrency: "USD",
      },
    ]);
  });
});
