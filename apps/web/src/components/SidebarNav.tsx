"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { CONNECTORS_CHANGED } from "../lib/appEvents";
import { providerDisplayName } from "../lib/providers";
import { useOrganization } from "../lib/useOrganization";

interface ConnectorInstance {
  id: string;
  provider: string;
  lastSyncAt: string | null;
}

/**
 * A provider gets its own dashboard link only once it's actually integrated:
 * at least one connector for it has synced successfully, so there's data to
 * show. Added-but-never-synced connectors stay on the Connectors page only.
 */
function integratedProviders(connectors: ConnectorInstance[]): string[] {
  return [...new Set(connectors.filter((c) => c.lastSyncAt !== null).map((c) => c.provider))].sort();
}

export function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProvider = searchParams.get("provider");
  const { organizationId } = useOrganization();
  const [providers, setProviders] = useState<string[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    function load() {
      api.get<ConnectorInstance[]>(`/connectors?organizationId=${organizationId}`).then((connectors) => {
        if (!cancelled) setProviders(integratedProviders(connectors));
      });
    }
    load();
    window.addEventListener(CONNECTORS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(CONNECTORS_CHANGED, load);
    };
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
            {providerDisplayName(p)} Cost
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
