"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

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

  function selectOrganization(id: string) {
    setOrganizationId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }

  async function createOrganization(name: string) {
    const org = await api.post<Organization>("/organizations", { name });
    setOrganizations((prev) => [...prev, org]);
    selectOrganization(org.id);
    return org;
  }

  return { organizations, organizationId, loading, selectOrganization, createOrganization };
}
