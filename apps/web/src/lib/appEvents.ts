"use client";

/**
 * The sidebar lives in the root layout and stays mounted across navigations,
 * so it never re-runs its effects when a page changes shared state. Pages
 * announce those changes with these window events and the sidebar listens.
 */
export const CONNECTORS_CHANGED = "cost-reporting:connectors-changed";
export const ORGANIZATION_CHANGED = "cost-reporting:organization-changed";

export function notifyConnectorsChanged() {
  window.dispatchEvent(new Event(CONNECTORS_CHANGED));
}

export function notifyOrganizationChanged(id: string) {
  window.dispatchEvent(new CustomEvent<string>(ORGANIZATION_CHANGED, { detail: id }));
}
