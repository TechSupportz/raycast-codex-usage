/** A single rate-limit window, normalised across providers. */
export type UsageWindow = {
  id: string;
  label: string;
  usedPercent: number;
  /** Epoch milliseconds, or null when the provider does not say. */
  resetsAt: number | null;
};

/** One of the banked rate-limit resets Codex grants. */
export type ResetCredit = {
  id: string;
  status: string;
  granted_at: string;
  expires_at: string;
  title?: string | null;
  description?: string | null;
};

export type ResetCreditsResponse = {
  credits: ResetCredit[];
  available_count: number;
};

/**
 * Why an account has no usage to show. `expired` is separated from `error`
 * because it is the one case the user can fix, and we tell them how.
 */
export type AccountFailure = {
  kind: "expired" | "error";
  message: string;
};

export type ProviderId = "codex" | "claude";

export type Account = {
  id: string;
  provider: ProviderId;
  /** Short name shown in the section header, e.g. "Personal". */
  label: string;
  /** Plan as the provider reports it, e.g. "plus", "education", "pro". */
  plan: string | null;
  email: string | null;
  windows: UsageWindow[];
  /** Codex only; null when the provider has no concept of banked resets. */
  resets: ResetCreditsResponse | null;
  failure: AccountFailure | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
