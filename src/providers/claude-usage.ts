export type ParsedUsageWindow = {
  id: string;
  label: string;
  usedPercent: number;
  resetsAt: number | null;
};

/**
 * Claude's OAuth endpoint exposes named top-level windows such as `five_hour`
 * and `seven_day`. The legacy array fallback keeps the parser tolerant of the
 * alternate normalised shape seen in older clients.
 */
export function parseClaudeUsagePayload(payload: unknown): ParsedUsageWindow[] {
  if (!isRecord(payload)) {
    throw new Error("Claude returned an unexpected usage response.");
  }

  const windows = Object.entries(payload).flatMap(([kind, value]) => {
    if (!isRecord(value) || typeof value.utilization !== "number") {
      return [];
    }

    return [
      {
        id: kind,
        label: formatLimitLabel(kind),
        usedPercent: value.utilization,
        resetsAt: parseResetAt(value.resets_at),
      },
    ];
  });

  if (windows.length > 0) {
    return windows;
  }

  const legacyWindows = Array.isArray(payload.limits) ? payload.limits.filter(isRecord) : [];
  const parsedLegacyWindows = legacyWindows.flatMap((limit) => {
    if (typeof limit.percent !== "number" || typeof limit.kind !== "string") {
      return [];
    }

    return [
      {
        id: limit.kind,
        label: formatLimitLabel(limit.kind),
        usedPercent: limit.percent,
        resetsAt: parseResetAt(limit.resets_at),
      },
    ];
  });

  if (parsedLegacyWindows.length === 0) {
    throw new Error("Claude returned an unexpected usage response.");
  }

  return parsedLegacyWindows;
}

function formatLimitLabel(kind: string): string {
  if (kind === "session" || kind === "five_hour") {
    return "Session Limit";
  }

  if (kind === "weekly_all" || kind === "seven_day") {
    return "Weekly Limit";
  }

  if (kind.startsWith("seven_day_")) {
    return `${formatWords(kind.slice("seven_day_".length))} Weekly Limit`;
  }

  const label = formatWords(kind);

  return label.endsWith("Limit") ? label : `${label} Limit`;
}

function formatWords(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseResetAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
