import { homedir } from "node:os";
import { basename, join } from "node:path";

export type CodexHomeConfig = {
  label: string;
  home: string;
};

export function parseCodexHomePaths(raw: string): CodexHomeConfig[] {
  const configs = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      const label = separator === -1 ? "" : entry.slice(0, separator).trim();
      const path = separator === -1 ? entry : entry.slice(separator + 1).trim();
      const home = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;

      return { label: label || deriveLabel(home), home };
    })
    .filter(({ home }) => home.length > 0);

  return [...new Map(configs.map((config) => [config.home, config])).values()];
}

function deriveLabel(home: string): string {
  const suffix = basename(home)
    .replace(/^\.?codex/i, "")
    .replace(/^[-_]/, "");
  return suffix ? suffix.charAt(0).toUpperCase() + suffix.slice(1) : "Personal";
}
