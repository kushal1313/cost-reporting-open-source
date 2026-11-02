"use client";

import { Fragment, useEffect, useState } from "react";
import { api } from "../../lib/api";
import { notifyConnectorsChanged } from "../../lib/appEvents";
import { providerDisplayName } from "../../lib/providers";
import { useOrganization } from "../../lib/useOrganization";

interface ConnectorInstance {
  id: string;
  provider: string;
  name: string;
  status: "PENDING" | "ACTIVE" | "ERROR" | "DISABLED";
  lastSyncAt: string | null;
  lastSyncError: string | null;
  seatPricePerMonth: number | null;
  seatCount: number | null;
  ingestion: "api" | "file";
}

const PROVIDERS = ["AWS", "Datadog", "GrafanaCloud", "Anthropic", "OpenAI"] as const;

const PROVIDER_LABELS: Record<(typeof PROVIDERS)[number], string> = {
  AWS: "AWS",
  Datadog: "Datadog",
  GrafanaCloud: "Grafana Cloud",
  Anthropic: "Claude Enterprise",
  OpenAI: "ChatGPT Enterprise / Business",
};

const CONFIG_PLACEHOLDER: Record<(typeof PROVIDERS)[number], string> = {
  AWS: '{\n  "billingAccountId": "123456789012",\n  "roleArn": "arn:aws:iam::123456789012:role/cost-reporting-read-only"\n}',
  Datadog: '{\n  "apiKey": "...",\n  "appKey": "...",\n  "site": "datadoghq.com"\n}',
  GrafanaCloud: '{\n  "orgSlug": "my-org",\n  "accessToken": "..."\n}',
  // Analytics API key (read:analytics), created by the primary owner at
  // claude.ai > Organization settings > API.
  Anthropic: '{\n  "apiKey": "...",\n  "organizationName": "Acme"\n}',
  // With adminKey + workspaceId the connector syncs from the Admin API; leave
  // them out to import admin console CSV exports instead. creditPriceUsd is
  // the contract's USD per credit.
  OpenAI:
    '{\n  "adminKey": "sk-admin-...",\n  "workspaceId": "<workspace UUID>",\n  "workspaceName": "Acme",\n  "creditPriceUsd": 0.04\n}',
};

function seatPlanSummary(c: ConnectorInstance): string {
  if (c.seatPricePerMonth == null) return "—";
  const seats = c.seatCount == null ? "seats from provider" : `${c.seatCount} seats`;
  return `$${c.seatPricePerMonth.toFixed(2)}/seat/month × ${seats}`;
}

function SeatPlanEditor({
  connector,
  onSave,
  onCancel,
}: {
  connector: ConnectorInstance;
  onSave: (price: number | null, seats: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [price, setPrice] = useState(connector.seatPricePerMonth?.toString() ?? "");
  const [seats, setSeats] = useState(connector.seatCount?.toString() ?? "");
  return (
    <form
      style={{ flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", gap: 12, maxWidth: "none" }}
      onSubmit={async (e) => {
        e.preventDefault();
        await onSave(price.trim() ? Number(price) : null, seats.trim() ? Number(seats) : null);
      }}
    >
      <label style={{ maxWidth: 220 }}>
        Price per seat per month (USD)
        <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label style={{ maxWidth: 260 }}>
        Seats (blank = ask the provider, where supported)
        <input type="number" min="1" step="1" value={seats} onChange={(e) => setSeats(e.target.value)} />
      </label>
      <button type="submit">Save seat plan</button>
      <button type="button" className="secondary" onClick={onCancel}>
        Cancel
      </button>
      <p className="muted" style={{ flexBasis: "100%", margin: 0 }}>
        Seat fees come from your contract — neither vendor reports them per person. Clear the price to stop
        booking seat fees. Applies from the next sync or import.
      </p>
    </form>
  );
}

export default function ConnectorsPage() {
  const {
    organizations,
    organizationId,
    loading: orgLoading,
    selectOrganization,
    createOrganization,
  } = useOrganization();
  const [connectors, setConnectors] = useState<ConnectorInstance[]>([]);
  const [newOrgName, setNewOrgName] = useState("");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>("AWS");
  const [name, setName] = useState("");
  const [config, setConfig] = useState(CONFIG_PLACEHOLDER.AWS);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingSeatsFor, setEditingSeatsFor] = useState<string | null>(null);
  // How far back "Sync" fetches; the dashboard can show up to 3 months, so
  // syncing that far is what fills its "Last 3 months" view.
  const [syncDays, setSyncDays] = useState(30);
  const [rowMessage, setRowMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function refresh(orgId: string) {
    api.get<ConnectorInstance[]>(`/connectors?organizationId=${orgId}`).then(setConnectors);
  }

  useEffect(() => {
    if (organizationId) refresh(organizationId);
  }, [organizationId]);

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    await createOrganization(newOrgName.trim());
    setNewOrgName("");
  }

  async function handleAddConnector(e: React.FormEvent) {
    e.preventDefault();
    if (!organizationId) return;
    setSubmitting(true);
    setError(null);
    try {
      const parsedConfig = JSON.parse(config);
      await api.post("/connectors", {
        organizationId,
        provider,
        name: name || provider,
        config: parsedConfig,
      });
      setName("");
      refresh(organizationId);
      notifyConnectorsChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add connector");
    } finally {
      setSubmitting(false);
    }
  }

  // Sync and import failures come back as error responses; show them rather
  // than leaving the button silently doing nothing.
  async function runRowAction(action: () => Promise<string>) {
    if (!organizationId) return;
    setRowMessage(null);
    try {
      setRowMessage({ ok: true, text: await action() });
    } catch (err) {
      setRowMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
    refresh(organizationId);
    notifyConnectorsChanged();
  }

  function handleSync(id: string) {
    const to = new Date();
    const from = new Date(to.getTime() - syncDays * 86400000);
    return runRowAction(async () => {
      await api.post(`/connectors/${id}/sync?organizationId=${organizationId}`, {
        start: from.toISOString(),
        end: to.toISOString(),
      });
      return `Synced the last ${syncDays} days.`;
    });
  }

  // Each file is its own import, so one bad file doesn't stop the rest; the
  // message lists how each went.
  function handleImport(id: string, files: File[]) {
    return runRowAction(async () => {
      const lines: string[] = [];
      let failed = 0;
      for (const file of files) {
        try {
          const result = await api.post<{ start: string; end: string; dataset: string | null }>(
            `/connectors/${id}/import?organizationId=${organizationId}`,
            { content: await file.text(), fileName: file.name },
          );
          const last = new Date(new Date(result.end).getTime() - 86400000);
          lines.push(
            `✓ ${file.name}${result.dataset ? ` (${result.dataset})` : ""}: ${result.start.slice(0, 10)} to ${last.toISOString().slice(0, 10)}`,
          );
        } catch (err) {
          failed++;
          lines.push(`✗ ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failed > 0) throw new Error(lines.join("\n"));
      return lines.join("\n");
    });
  }

  async function handleSaveSeatPlan(id: string, seatPricePerMonth: number | null, seatCount: number | null) {
    await runRowAction(async () => {
      await api.post(`/connectors/${id}/seat-plan?organizationId=${organizationId}`, {
        seatPricePerMonth,
        seatCount,
      });
      return "Seat plan saved — it applies from the next sync or import.";
    });
    setEditingSeatsFor(null);
  }

  async function handleDelete(id: string) {
    if (!organizationId) return;
    await api.del(`/connectors/${id}?organizationId=${organizationId}`);
    refresh(organizationId);
    notifyConnectorsChanged();
  }

  if (orgLoading) return <p>Loading…</p>;

  if (!organizationId) {
    return (
      <div>
        <h1>Connectors</h1>
        <p>Create an organization to get started.</p>
        <form onSubmit={handleCreateOrg}>
          <label>
            Organization name
            <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} required />
          </label>
          <button type="submit">Create organization</button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <h1>Connectors</h1>

      {organizations.length > 1 && (
        <label style={{ maxWidth: 300, marginBottom: 20 }}>
          Organization
          <select value={organizationId} onChange={(e) => selectOrganization(e.target.value)}>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="card">
        <h2>Connected accounts</h2>
        {connectors.some((c) => c.ingestion === "api") && (
          <label style={{ maxWidth: 220, marginBottom: 12 }}>
            Sync range
            <select value={syncDays} onChange={(e) => setSyncDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 3 months</option>
            </select>
          </label>
        )}
        {connectors.length === 0 ? (
          <p>No connectors yet — add one below.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Last sync</th>
                <th>Seat plan</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {connectors.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td>{c.name}</td>
                    <td>{providerDisplayName(c.provider)}</td>
                    <td className={`status-${c.status}`} title={c.lastSyncError ?? undefined}>
                      {c.status}
                    </td>
                    <td>{c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : "never"}</td>
                    <td>{seatPlanSummary(c)}</td>
                    <td style={{ display: "flex", gap: 8 }}>
                      {c.ingestion === "file" ? (
                        <label className="button">
                          Import CSVs
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            multiple
                            hidden
                            onChange={(e) => {
                              const files = [...(e.target.files ?? [])];
                              e.target.value = "";
                              if (files.length > 0) handleImport(c.id, files);
                            }}
                          />
                        </label>
                      ) : (
                        <button onClick={() => handleSync(c.id)}>Sync</button>
                      )}
                      <button className="secondary" onClick={() => setEditingSeatsFor(c.id)}>
                        Seats
                      </button>
                      <button className="secondary" onClick={() => handleDelete(c.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                  {editingSeatsFor === c.id && (
                    <tr>
                      <td colSpan={6}>
                        <SeatPlanEditor
                          connector={c}
                          onSave={(price, seats) => handleSaveSeatPlan(c.id, price, seats)}
                          onCancel={() => setEditingSeatsFor(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {c.status === "ERROR" && c.lastSyncError && (
                    <tr>
                      <td colSpan={6} style={{ color: "#e2626b" }}>
                        {c.lastSyncError}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        {rowMessage && (
          <p style={{ color: rowMessage.ok ? undefined : "#e2626b", whiteSpace: "pre-line" }}>
            {rowMessage.text}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Add a connector</h2>
        <form onSubmit={handleAddConnector}>
          <label>
            Provider
            <select
              value={provider}
              onChange={(e) => {
                const p = e.target.value as (typeof PROVIDERS)[number];
                setProvider(p);
                setConfig(CONFIG_PLACEHOLDER[p]);
              }}
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. "${provider} prod"`}
            />
          </label>
          <label>
            Config (JSON — read-only credentials for this provider)
            <textarea value={config} onChange={(e) => setConfig(e.target.value)} required />
          </label>
          {error && <p style={{ color: "#e2626b" }}>{error}</p>}
          <button type="submit" disabled={submitting}>
            {submitting ? "Validating…" : "Add connector"}
          </button>
        </form>
      </div>
    </div>
  );
}
