"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useOrganization } from "../../lib/useOrganization";

interface NotificationChannel {
  id: string;
  type: "slack" | "email" | "webhook";
  name: string;
}

interface AlertRule {
  id: string;
  condition: string;
  thresholdPercent: number | null;
  lastTriggeredAt: string | null;
  notificationChannel: { id: string; name: string; type: string };
}

interface Budget {
  id: string;
  name: string;
  amount: string;
  currency: string;
  period: "MONTHLY" | "QUARTERLY" | "YEARLY";
  scopeFilter: Record<string, unknown>;
  alertRules: AlertRule[];
}

interface BudgetStatus {
  spend: number;
  percentUsed: number;
}

const CHANNEL_CONFIG_PLACEHOLDER: Record<NotificationChannel["type"], string> = {
  slack: '{ "webhookUrl": "https://hooks.slack.com/services/..." }',
  email: '{ "to": "team@example.com" }',
  webhook: '{ "url": "https://example.com/hooks/cost-alert" }',
};

export default function BudgetsPage() {
  const { organizationId, loading: orgLoading } = useOrganization();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [statuses, setStatuses] = useState<Record<string, BudgetStatus>>({});
  const [channels, setChannels] = useState<NotificationChannel[]>([]);

  const [budgetName, setBudgetName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<Budget["period"]>("MONTHLY");
  const [scopeFilter, setScopeFilter] = useState("{}");

  const [channelType, setChannelType] = useState<NotificationChannel["type"]>("slack");
  const [channelName, setChannelName] = useState("");
  const [channelConfig, setChannelConfig] = useState(CHANNEL_CONFIG_PLACEHOLDER.slack);

  const [evaluating, setEvaluating] = useState(false);
  const [evaluateMessage, setEvaluateMessage] = useState<string | null>(null);

  function refresh(orgId: string) {
    api.get<Budget[]>(`/budgets?organizationId=${orgId}`).then((list) => {
      setBudgets(list);
      list.forEach((b) => {
        api
          .get<BudgetStatus>(`/budgets/${b.id}/status`)
          .then((s) => setStatuses((prev) => ({ ...prev, [b.id]: s })));
      });
    });
    api.get<NotificationChannel[]>(`/notification-channels?organizationId=${orgId}`).then(setChannels);
  }

  useEffect(() => {
    if (organizationId) refresh(organizationId);
  }, [organizationId]);

  async function handleAddBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    await api.post("/budgets", {
      organizationId,
      name: budgetName,
      amount: Number(amount),
      period,
      scopeFilter: JSON.parse(scopeFilter || "{}"),
    });
    setBudgetName("");
    setAmount("");
    refresh(organizationId);
  }

  async function handleAddChannel(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    await api.post("/notification-channels", {
      organizationId,
      type: channelType,
      name: channelName || channelType,
      config: JSON.parse(channelConfig),
    });
    setChannelName("");
    refresh(organizationId);
  }

  async function handleAddAlertRule(
    budgetId: string,
    notificationChannelId: string,
    thresholdPercent: number,
  ) {
    await api.post(`/budgets/${budgetId}/alert-rules`, {
      notificationChannelId,
      condition: "THRESHOLD_PERCENT",
      thresholdPercent,
    });
    if (organizationId) refresh(organizationId);
  }

  async function handleEvaluateNow() {
    setEvaluating(true);
    setEvaluateMessage(null);
    try {
      const results = await api.post<Array<{ budgetId: string; spend: number; percentUsed: number }>>(
        "/budgets/evaluate",
        {},
      );
      setEvaluateMessage(
        `Evaluated ${results.length} budget(s) at ${new Date().toLocaleTimeString()} — check your notification channel(s) for any alerts that crossed threshold.`,
      );
      if (organizationId) refresh(organizationId);
    } catch (err) {
      setEvaluateMessage(err instanceof Error ? `Evaluation failed: ${err.message}` : "Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  }

  if (orgLoading) return <p>Loading…</p>;
  if (!organizationId) {
    return (
      <p>
        Create an organization from the <a href="/connectors">Connectors</a> page first.
      </p>
    );
  }

  return (
    <div>
      <h1>Budgets</h1>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Existing budgets</h2>
          <button type="button" onClick={handleEvaluateNow} disabled={evaluating || budgets.length === 0}>
            {evaluating ? "Evaluating…" : "Evaluate now"}
          </button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>
          Alerts fire on a schedule in production; there's no scheduler wired up yet, so use this to trigger
          evaluation manually while testing.
        </p>
        {evaluateMessage && <p style={{ color: "var(--accent-2)", fontSize: 13 }}>{evaluateMessage}</p>}
        {budgets.length === 0 ? (
          <p>No budgets yet — add one below.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Period</th>
                <th>Amount</th>
                <th>Spend</th>
                <th>Alerts</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map((b) => {
                const status = statuses[b.id];
                return (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.period}</td>
                    <td>
                      {b.amount} {b.currency}
                    </td>
                    <td>{status ? `${status.spend.toFixed(2)} (${status.percentUsed.toFixed(0)}%)` : "…"}</td>
                    <td>
                      {b.alertRules.length === 0 ? (
                        <AddAlertRuleInline budgetId={b.id} channels={channels} onAdd={handleAddAlertRule} />
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {b.alertRules.map((r) => (
                            <span key={r.id}>
                              {r.notificationChannel.name} @ {r.thresholdPercent}%{" "}
                              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                                {r.lastTriggeredAt
                                  ? `· fired ${new Date(r.lastTriggeredAt).toLocaleTimeString()}`
                                  : "· not fired yet"}
                              </span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Add a budget</h2>
        <form onSubmit={handleAddBudget}>
          <label>
            Name
            <input value={budgetName} onChange={(e) => setBudgetName(e.target.value)} required />
          </label>
          <label>
            Amount (USD)
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </label>
          <label>
            Period
            <select value={period} onChange={(e) => setPeriod(e.target.value as Budget["period"])}>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="YEARLY">Yearly</option>
            </select>
          </label>
          <label>
            Scope filter (JSON — e.g. {`{"providerName": "AWS"}`}, leave as {`{}`} for all spend)
            <textarea value={scopeFilter} onChange={(e) => setScopeFilter(e.target.value)} />
          </label>
          <button type="submit">Add budget</button>
        </form>
      </div>

      <div className="card">
        <h2>Notification channels</h2>
        {channels.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form onSubmit={handleAddChannel}>
          <label>
            Type
            <select
              value={channelType}
              onChange={(e) => {
                const t = e.target.value as NotificationChannel["type"];
                setChannelType(t);
                setChannelConfig(CHANNEL_CONFIG_PLACEHOLDER[t]);
              }}
            >
              <option value="slack">Slack</option>
              <option value="email">Email</option>
              <option value="webhook">Generic webhook</option>
            </select>
          </label>
          <label>
            Name
            <input value={channelName} onChange={(e) => setChannelName(e.target.value)} />
          </label>
          <label>
            Config (JSON)
            <textarea value={channelConfig} onChange={(e) => setChannelConfig(e.target.value)} required />
          </label>
          <button type="submit">Add channel</button>
        </form>
      </div>
    </div>
  );
}

function AddAlertRuleInline({
  budgetId,
  channels,
  onAdd,
}: {
  budgetId: string;
  channels: NotificationChannel[];
  onAdd: (budgetId: string, channelId: string, threshold: number) => void;
}) {
  // `channels` often arrives asynchronously after this component's first
  // render (it's fetched in parallel with budgets), so we can't just seed
  // useState from channels[0] once. Track the user's explicit pick, if any,
  // and fall back to the first channel at render time otherwise — no effect
  // needed, so there's no stale-state window.
  const [channelIdOverride, setChannelIdOverride] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(80);

  if (channels.length === 0) return <span>Add a notification channel first</span>;

  const channelId =
    channelIdOverride && channels.some((c) => c.id === channelIdOverride)
      ? channelIdOverride
      : channels[0].id;

  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <select value={channelId} onChange={(e) => setChannelIdOverride(e.target.value)}>
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        type="number"
        style={{ width: 60 }}
        value={threshold}
        onChange={(e) => setThreshold(Number(e.target.value))}
      />
      %
      <button type="button" disabled={!channelId} onClick={() => onAdd(budgetId, channelId, threshold)}>
        Add
      </button>
    </span>
  );
}
