"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useOrganization } from "../../lib/useOrganization";

interface ConnectorInstance {
  id: string;
  provider: string;
  name: string;
  status: "PENDING" | "ACTIVE" | "ERROR" | "DISABLED";
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

const PROVIDERS = ["AWS", "Datadog", "GrafanaCloud"] as const;

const CONFIG_PLACEHOLDER: Record<(typeof PROVIDERS)[number], string> = {
  AWS: '{\n  "billingAccountId": "123456789012",\n  "roleArn": "arn:aws:iam::123456789012:role/cost-reporting-read-only"\n}',
  Datadog: '{\n  "apiKey": "...",\n  "appKey": "...",\n  "site": "datadoghq.com"\n}',
  GrafanaCloud: '{\n  "orgSlug": "my-org",\n  "accessToken": "..."\n}',
};

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add connector");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSync(id: string) {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    await api.post(`/connectors/${id}/sync`, { start: from.toISOString(), end: to.toISOString() });
    if (organizationId) refresh(organizationId);
  }

  async function handleDelete(id: string) {
    await api.del(`/connectors/${id}`);
    if (organizationId) refresh(organizationId);
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
                <th></th>
              </tr>
            </thead>
            <tbody>
              {connectors.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.provider}</td>
                  <td className={`status-${c.status}`} title={c.lastSyncError ?? undefined}>
                    {c.status}
                  </td>
                  <td>{c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : "never"}</td>
                  <td style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => handleSync(c.id)}>Sync last 30d</button>
                    <button className="secondary" onClick={() => handleDelete(c.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  {p}
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
