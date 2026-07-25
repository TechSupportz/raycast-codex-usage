import { getPreferenceValues, type Image } from "@raycast/api";
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

type IconPreferences = {
  codexIcon?: string;
  claudeIcon?: string;
};

const ICON_PREFERENCE: Record<ProviderId, keyof IconPreferences> = {
  codex: "codexIcon",
  claude: "claudeIcon",
};

/**
 * `claude.svg` is the official mark from Simple Icons (CC0); Simple Icons has no
 * OpenAI mark, so `codex.svg` ships as a stand-in. Either can be overridden per
 * provider from the extension's preferences.
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
  const branding = BRANDING[provider];
  const override = getPreferenceValues<IconPreferences>()[ICON_PREFERENCE[provider]]?.trim();

  // A file preference hands us an absolute path, which `source` accepts the
  // same way it accepts a bundled asset name.
  return override ? { ...branding, icon: override } : branding;
}
