"use client";

const DAY_MS = 86_400_000;

export type RangePreset = "7d" | "30d" | "90d" | "custom";

export interface DateRangeValue {
  preset: RangePreset;
  /** Custom range, as inclusive YYYY-MM-DD dates. */
  customFrom: string;
  customTo: string;
}

const PRESET_DAYS: Record<Exclude<RangePreset, "custom">, number> = { "7d": 7, "30d": 30, "90d": 90 };

const PRESET_LABELS: Record<RangePreset, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 3 months",
  custom: "Custom range",
};

function utcDay(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS;
}

function toDateInput(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function defaultDateRange(): DateRangeValue {
  const today = utcDay(Date.now());
  return { preset: "30d", customFrom: toDateInput(today - 29 * DAY_MS), customTo: toDateInput(today) };
}

/**
 * The selected range as whole UTC days, half-open [from, to): "last 7 days"
 * is today and the 6 days before it, and a custom range includes its end date.
 * Whole days line up with how connectors store data, so totals don't pick up
 * a stray partial day at either edge.
 */
export function resolveDateRange(value: DateRangeValue): { from: string; to: string; label: string } {
  if (value.preset === "custom") {
    const from = Date.parse(`${value.customFrom}T00:00:00Z`);
    const to = Date.parse(`${value.customTo}T00:00:00Z`) + DAY_MS;
    return {
      from: new Date(from).toISOString(),
      to: new Date(Math.max(to, from + DAY_MS)).toISOString(),
      label: `${value.customFrom} to ${value.customTo}`,
    };
  }
  const tomorrow = utcDay(Date.now()) + DAY_MS;
  return {
    from: new Date(tomorrow - PRESET_DAYS[value.preset] * DAY_MS).toISOString(),
    to: new Date(tomorrow).toISOString(),
    label: PRESET_LABELS[value.preset],
  };
}

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
}) {
  const customInvalid = value.preset === "custom" && value.customFrom > value.customTo;
  return (
    <div className="range-filter">
      <div className="segmented" role="group" aria-label="Date range">
        {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
          <button
            key={p}
            type="button"
            className={value.preset === p ? "active" : undefined}
            aria-pressed={value.preset === p}
            onClick={() => onChange({ ...value, preset: p })}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="range-inputs">
          <label>
            From
            <input
              type="date"
              value={value.customFrom}
              max={value.customTo}
              onChange={(e) => e.target.value && onChange({ ...value, customFrom: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={value.customTo}
              min={value.customFrom}
              onChange={(e) => e.target.value && onChange({ ...value, customTo: e.target.value })}
            />
          </label>
          {customInvalid && <span style={{ color: "#e2626b" }}>“From” must be on or before “To”.</span>}
        </div>
      )}
    </div>
  );
}
