"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AccountFilterDropdown, type AccountOption } from "../../components/AccountFilterDropdown";
import { CostBreakdownChart, type CostBreakdownRow } from "../../components/CostBreakdownChart";
import { CostTrendChart, type TrendPoint } from "../../components/CostTrendChart";
import {
  DateRangeFilter,
  defaultDateRange,
  resolveDateRange,
  type DateRangeValue,
} from "../../components/DateRangeFilter";
import { TopPeopleTable, type TopPeople } from "../../components/TopPeopleTable";
import { api } from "../../lib/api";
import { providerDisplayName } from "../../lib/providers";
import { useOrganization } from "../../lib/useOrganization";

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
  // Per-user AI tools (Claude, ChatGPT): seats vs usage, groups, and top people.
  const [chargeSplit, setChargeSplit] = useState<CostBreakdownRow[]>([]);
  const [groups, setGroups] = useState<CostBreakdownRow[]>([]);
  const [people, setPeople] = useState<TopPeople>({ basis: "none", rows: [] });
  const [range, setRange] = useState<DateRangeValue>(defaultDateRange);
  const { from, to, label: rangeLabel } = resolveDateRange(range);
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
      provider
        ? api.get<CostBreakdownRow[]>(
            `/costs?organizationId=${organizationId}&from=${from}&to=${to}&groupBy=chargeCategory${accountParam}${providerParam}`,
          )
        : Promise.resolve([]),
      provider
        ? api.get<CostBreakdownRow[]>(
            `/costs/groups?organizationId=${organizationId}&from=${from}&to=${to}${providerParam}`,
          )
        : Promise.resolve([]),
      provider
        ? api.get<TopPeople>(
            `/costs/users?organizationId=${organizationId}&from=${from}&to=${to}&limit=10${providerParam}`,
          )
        : Promise.resolve<TopPeople>({ basis: "none", rows: [] }),
    ])
      .then(([b, a, t, c, g, p]) => {
        setBreakdown(b);
        setAccountBreakdown(a);
        setTrend(t);
        setChargeSplit(c);
        setGroups(g);
        setPeople(p);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, selectedAccountIds, provider, from, to]);

  if (orgLoading) return <p>Loading…</p>;
  if (!organizationId) {
    return (
      <p>
        No organization yet — create one from the <a href="/connectors">Connectors</a> page.
      </p>
    );
  }

  const total = breakdown.reduce((sum, r) => sum + r.effectiveCost, 0);
  const seatCost = chargeSplit.find((r) => r.group === "Purchase")?.effectiveCost ?? 0;
  // A per-user tool is one whose data names people; for those, the account
  // chart is just the org plus a seats row, so groups and people replace it.
  const isPerUserTool = people.basis !== "none" || groups.length > 0;

  return (
    <div>
      <h1>{provider ? `${providerDisplayName(provider)} Cost Dashboard` : "Cost Dashboard"}</h1>
      <DateRangeFilter value={range} onChange={setRange} />
      <p className="total">
        {rangeLabel}
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
          {seatCost > 0 && (
            <div className="kpis">
              <div className="kpi">
                Seats (from seat plan)
                <strong>${seatCost.toFixed(2)}</strong>
              </div>
              <div className="kpi">
                Usage
                <strong>${(total - seatCost).toFixed(2)}</strong>
              </div>
            </div>
          )}
          <div className="card">
            <h2>{provider ? (isPerUserTool ? "Usage by product" : "By service") : "By provider"}</h2>
            {/* Seat fees have their own tile and would dwarf every product bar. */}
            <CostBreakdownChart
              data={seatCost > 0 ? breakdown.filter((r) => r.group !== "Seats") : breakdown}
            />
          </div>
          {isPerUserTool && groups.length > 0 && (
            <div className="card">
              <h2>By group</h2>
              <CostBreakdownChart data={groups} />
              {provider === "Anthropic" && (
                <p className="muted">
                  Usage only. Someone in several teams counts in full toward each, so groups can add up to
                  more than the total.
                </p>
              )}
            </div>
          )}
          {isPerUserTool && (
            <div className="card">
              <h2>Top 10 people · {rangeLabel}</h2>
              <TopPeopleTable data={people} />
            </div>
          )}
          {!isPerUserTool && (
            <div className="card">
              <h2>By account</h2>
              <CostBreakdownChart data={accountBreakdown} />
            </div>
          )}
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
