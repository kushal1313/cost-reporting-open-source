"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { notifyOrganizationChanged, ORGANIZATION_CHANGED } from "./appEvents";

export interface Organization {
  id: string;
  name: string;
}

const STORAGE_KEY = "cost-reporting.organizationId";

/**
 * There's no auth yet (see apps/api/src/routes/organizations.ts), so the
 * "current org" is just remembered per-browser in localStorage.
 */
export function useOrganization() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<Organization[]>("/organizations").then((orgs) => {
      setOrganizations(orgs);
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const initial = orgs.find((o) => o.id === stored)?.id ?? orgs[0]?.id ?? null;
      setOrganizationId(initial);
      setLoading(false);
    });
  }, []);

  // Each component calling this hook has its own state, so follow selections
  // made elsewhere (e.g. the sidebar tracking a switch on the Connectors page).
  useEffect(() => {
    function onChange(e: Event) {
      setOrganizationId((e as CustomEvent<string>).detail);
    }
    window.addEventListener(ORGANIZATION_CHANGED, onChange);
    return () => window.removeEventListener(ORGANIZATION_CHANGED, onChange);
  }, []);

  function selectOrganization(id: string) {
    setOrganizationId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
    notifyOrganizationChanged(id);
  }

  async function createOrganization(name: string) {
    const org = await api.post<Organization>("/organizations", { name });
    setOrganizations((prev) => [...prev, org]);
    selectOrganization(org.id);
    return org;
  }

  return { organizations, organizationId, loading, selectOrganization, createOrganization };
}
