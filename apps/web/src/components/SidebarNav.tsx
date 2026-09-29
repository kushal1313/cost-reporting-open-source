"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useOrganization } from "../lib/useOrganization";

interface ConnectorInstance {
  id: string;
  provider: string;
}

export function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProvider = searchParams.get("provider");
  const { organizationId } = useOrganization();
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    api.get<ConnectorInstance[]>(`/connectors?organizationId=${organizationId}`).then((connectors) => {
      setProviders([...new Set(connectors.map((c) => c.provider))].sort());
    });
  }, [organizationId]);

  function isDashboardActive(provider?: string) {
    if (pathname !== "/dashboard") return false;
    return provider ? activeProvider === provider : !activeProvider;
  }

  return (
    <nav>
      <div className="nav-group">
        <div className="nav-group-label">Cost Reporting</div>
        <Link href="/dashboard" className={isDashboardActive() ? "active" : undefined}>
          Overview
        </Link>
        {providers.map((p) => (
          <Link
            key={p}
            href={`/dashboard?provider=${encodeURIComponent(p)}`}
            className={isDashboardActive(p) ? "active" : undefined}
          >
            {p} Cost
          </Link>
        ))}
        <Link href="/connectors" className={pathname === "/connectors" ? "active" : undefined}>
          Connectors
        </Link>
        <Link href="/budgets" className={pathname === "/budgets" ? "active" : undefined}>
          Budgets
        </Link>
      </div>

      <div className="nav-group">
        <div className="nav-group-label">Security Score</div>
        <Link href="/security" className={pathname === "/security" ? "active" : undefined}>
          Overview
        </Link>
      </div>
    </nav>
  );
}
