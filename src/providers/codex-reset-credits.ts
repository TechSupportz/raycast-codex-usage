import { parseResetExpiry } from "../reset-expiry";
import { isRecord, type ResetCredit, type ResetCreditsResponse } from "./types";

const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

export async function fetchCodexResetCredits(token: string, accountId: string | null): Promise<ResetCreditsResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "OpenAI-Beta": "codex-1",
    originator: "Codex Desktop",
    "User-Agent": "raycast-ai-usage",
    Accept: "application/json",
  };

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  const response = await fetch(RESET_CREDITS_URL, {
    headers,
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Codex reset credits returned HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();

  if (!isRecord(payload) || !Array.isArray(payload.credits)) {
    throw new Error("Codex returned an invalid reset-credit response.");
  }

  const credits = payload.credits.filter(isResetCredit);
  return { credits, available_count: credits.filter((credit) => credit.status === "available").length };
}

function isResetCredit(value: unknown): value is ResetCredit {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string" &&
    typeof value.granted_at === "string" &&
    Number.isFinite(parseResetExpiry(value.granted_at)) &&
    typeof value.expires_at === "string" &&
    Number.isFinite(parseResetExpiry(value.expires_at)) &&
    (value.title == null || typeof value.title === "string") &&
    (value.description == null || typeof value.description === "string")
  );
}
