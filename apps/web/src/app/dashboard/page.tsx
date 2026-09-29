"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AccountFilterDropdown, type AccountOption } from "../../components/AccountFilterDropdown";
import { CostBreakdownChart, type CostBreakdownRow } from "../../components/CostBreakdownChart";
import { CostTrendChart, type TrendPoint } from "../../components/CostTrendChart";
import { api } from "../../lib/api";
import { useOrganization } from "../../lib/useOrganization";

function last30DaysRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function accountQueryParam(accountIds: string[]): string {
  return accountIds.map((id) => `&accountIds=${encodeURIComponent(id)}`).join("");
}

function DashboardContent({ provider }: { provider?: string }) {
  const providerParam = provider ? `&provider=${encodeURIComponent(provider)}` : "";

  const { organizationId, loading: orgLoading } = useOrganization();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [breakdown, setBreakdown] = useState<CostBreakdownRow[]>([]);
  const [accountBreakdown, setAccountBreakdown] = useState<CostBreakdownRow[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    api
      .get<AccountOption[]>(`/costs/accounts?organizationId=${organizationId}${providerParam}`)
      .then(setAccounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, provider]);

  useEffect(() => {
    if (!organizationId) return;
    const { from, to } = last30DaysRange();
    const accountParam = accountQueryParam(selectedAccountIds);
    // Once a single provider is already selected, breaking down "by provider" again is a no-op —
    // "by service" is the more useful first chart in that view.
    const primaryGroupBy = provider ? "serviceName" : "providerName";
    setLoading(true);
    Promise.all([
      api.get<CostBreakdownRow[]>(
        `/costs?organizationId=${organizationId}&from=${from}&to=${to}&groupBy=${primaryGroupBy}${accountParam}${providerParam}`,
      ),
      api.get<CostBreakdownRow[]>(
        `/costs?organizationId=${organizationId}&from=${from}&to=${to}&groupBy=account${accountParam}${providerParam}`,
      ),
      api.get<TrendPoint[]>(
        `/costs/trend?organizationId=${organizationId}&from=${from}&to=${to}${accountParam}${providerParam}`,
      ),
    ])
      .then(([b, a, t]) => {
        setBreakdown(b);
        setAccountBreakdown(a);
        setTrend(t);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, selectedAccountIds, provider]);

  if (orgLoading) return <p>Loading…</p>;
  if (!organizationId) {
    return (
      <p>
        No organization yet — create one from the <a href="/connectors">Connectors</a> page.
      </p>
    );
  }

  const total = breakdown.reduce((sum, r) => sum + r.effectiveCost, 0);

  return (
    <div>
      <h1>{provider ? `${provider} Cost Dashboard` : "Cost Dashboard"}</h1>
      <p className="total">
        Last 30 days
        {selectedAccountIds.length > 0 ? ` · ${selectedAccountIds.length} account(s) selected` : ""}:{" "}
        <strong>${total.toFixed(2)}</strong>
      </p>

      {accounts.length > 0 && (
        <div className="card">
          <h2>Filter by account</h2>
          <AccountFilterDropdown
            accounts={accounts}
            selectedAccountIds={selectedAccountIds}
            onChange={setSelectedAccountIds}
          />
        </div>
      )}

      {loading ? (
        <p>Loading costs…</p>
      ) : (
        <>
          <div className="card">
            <h2>{provider ? "By service" : "By provider"}</h2>
            <CostBreakdownChart data={breakdown} />
          </div>
          <div className="card">
            <h2>By account</h2>
            <CostBreakdownChart data={accountBreakdown} />
          </div>
          <div className="card">
            <h2>Daily trend</h2>
            <CostTrendChart data={trend} />
          </div>
        </>
      )}
    </div>
  );
}

function DashboardRoute() {
  const provider = useSearchParams().get("provider") ?? undefined;
  // Remounting on provider change (rather than resetting state in an effect)
  // means account-selection/breakdown/trend state can't leak between providers.
  return <DashboardContent key={provider ?? "all"} provider={provider} />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <DashboardRoute />
    </Suspense>
  );
}
