"use client";

import { useEffect, useRef, useState } from "react";

export interface AccountOption {
  accountId: string;
  accountName: string;
  provider: string;
}

interface AccountFilterDropdownProps {
  accounts: AccountOption[];
  selectedAccountIds: string[];
  onChange: (accountIds: string[]) => void;
}

export function AccountFilterDropdown({
  accounts,
  selectedAccountIds,
  onChange,
}: AccountFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function toggleAccount(accountId: string) {
    onChange(
      selectedAccountIds.includes(accountId)
        ? selectedAccountIds.filter((id) => id !== accountId)
        : [...selectedAccountIds, accountId],
    );
  }

  const filtered = accounts.filter((a) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return a.accountName.toLowerCase().includes(q) || a.accountId.toLowerCase().includes(q);
  });

  const label =
    selectedAccountIds.length === 0
      ? "All accounts"
      : selectedAccountIds.length === 1
        ? (accounts.find((a) => a.accountId === selectedAccountIds[0])?.accountName ?? "1 account selected")
        : `${selectedAccountIds.length} accounts selected`;

  return (
    <div className="dropdown" ref={rootRef}>
      <button type="button" className="dropdown-trigger" onClick={() => setOpen((o) => !o)}>
        <span>{label}</span>
        <svg
          className={`dropdown-chevron${open ? " open" : ""}`}
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M2 4l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="dropdown-panel">
          <input
            className="dropdown-search"
            placeholder="Search accounts…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <div className="dropdown-actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                onChange([]);
                setOpen(false);
              }}
            >
              All accounts
            </button>
            <button
              type="button"
              className="link-btn"
              onClick={() => onChange(accounts.map((a) => a.accountId))}
            >
              Select all
            </button>
            {selectedAccountIds.length > 0 && (
              <button type="button" className="link-btn" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
          <div className="dropdown-list">
            {filtered.length === 0 ? (
              <p className="dropdown-empty">No matching accounts</p>
            ) : (
              filtered.map((a) => (
                <label key={a.accountId} className="dropdown-row">
                  <input
                    type="checkbox"
                    checked={selectedAccountIds.includes(a.accountId)}
                    onChange={() => toggleAccount(a.accountId)}
                  />
                  <span className="dropdown-row-name">{a.accountName}</span>
                  <span className="dropdown-row-meta">
                    {a.provider} · {a.accountId}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
