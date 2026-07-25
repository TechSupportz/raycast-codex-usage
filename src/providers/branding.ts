import { type Image } from "@raycast/api";
import type { ProviderId } from "./types";

type Branding = {
  /** Product name shown on an account's header row. */
  name: string;
  /** Asset filename; the view tints it when an account is loading or broken. */
  icon: Image.Source;
  /**
   * Window labels the provider almost always returns. Used only to shape the
   * loading skeleton so rows do not jump once the real response lands.
   */
  skeletonWindows: string[];
};

/**
 * `claude.svg` is the official mark from Simple Icons (CC0); Simple Icons has no
 * OpenAI mark, so `codex.svg` ships as a stand-in.
 */
const BRANDING: Record<ProviderId, Branding> = {
  codex: {
    name: "Codex",
    icon: "codex.svg",
    skeletonWindows: ["5h Limit", "Weekly Limit"],
  },
  claude: {
    name: "Claude Code",
    icon: "claude.svg",
    skeletonWindows: ["Session Limit", "Weekly Limit"],
  },
};

export function getBranding(provider: ProviderId): Branding {
  return BRANDING[provider];
}
