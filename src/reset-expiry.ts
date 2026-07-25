const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Reset-credit timestamps are UTC. Some API responses omit the UTC suffix,
 * which JavaScript would otherwise interpret in the computer's local timezone.
 */
export function parseResetExpiry(date: string): number {
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(date);
  const isDateTime = /^\d{4}-\d{2}-\d{2}T/.test(date);

  return Date.parse(isDateTime && !hasTimeZone ? `${date}Z` : date);
}

export function formatResetTimeRemaining(date: string, now = Date.now()): string {
  const millisecondsRemaining = parseResetExpiry(date) - now;

  if (millisecondsRemaining <= 0) {
    return "Expired";
  }

  if (millisecondsRemaining <= 2 * DAY_MS) {
    return `${Math.ceil(millisecondsRemaining / HOUR_MS)}h`;
  }

  return `${Math.floor(millisecondsRemaining / DAY_MS)}d`;
}
