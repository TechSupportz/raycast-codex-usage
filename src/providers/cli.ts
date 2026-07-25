import { existsSync } from "node:fs";

const STANDARD_CLI_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

export function resolveExecutable(candidates: readonly string[], fallback: string): string {
  return candidates.find((candidate) => candidate !== fallback && existsSync(candidate)) ?? fallback;
}

export function buildCliPath(extraPaths: readonly string[]): string {
  return [process.env.PATH, ...STANDARD_CLI_PATHS, ...extraPaths]
    .filter((path): path is string => Boolean(path))
    .join(":");
}
