import { Action, ActionPanel, Color, Detail, Icon, List, showToast, Toast } from "@raycast/api";
import { usePromise, getProgressIcon } from "@raycast/utils";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

type RateLimitWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};

type RateLimitSnapshot = {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  credits: unknown;
  planType: string | null;
  rateLimitReachedType: string | null;
};

type GetAccountRateLimitsResponse = {
  rateLimits: RateLimitSnapshot;
  rateLimitsByLimitId: Record<string, RateLimitSnapshot | undefined> | null;
};

type Thread = {
  id: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  source: string;
  name: string | null;
};

type ThreadListResponse = {
  data: Thread[];
  nextCursor: string | null;
  backwardsCursor: string | null;
};

type RpcResponse = {
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
};

type DisplayWindow = {
  id: string;
  label: string;
  window: RateLimitWindow;
};

type UsageData = {
  rateLimits: GetAccountRateLimitsResponse;
  threads: Thread[];
};

const REQUEST_TIMEOUT_MS = 20000;
const CODEX_EXECUTABLE_CANDIDATES = [
  "/opt/homebrew/bin/codex",
  "/usr/local/bin/codex",
  "/usr/bin/codex",
  join(homedir(), ".local/bin/codex"),
  join(homedir(), ".npm-global/bin/codex"),
  "codex",
];

export default function Command() {
  const { data, error, isLoading, revalidate } = usePromise(fetchCodexUsage);
  const windows = data ? getCodexWindows(data.rateLimits) : [];
  const activity = data ? getRecentActivity(data.threads) : null;

  const refreshAction = (
    <Action
      title="Refresh"
      icon={Icon.ArrowClockwise}
      onAction={revalidate}
      shortcut={{ modifiers: ["cmd"], key: "r" }}
    />
  );

  if (error) {
    return (
      <Detail
        markdown={`# Unable to load Codex usage\n\n${error.message}\n\nMake sure Codex is installed and signed in with \`codex login\`.`}
        actions={
          <ActionPanel>
            <Action title="Retry" icon={Icon.ArrowClockwise} onAction={revalidate} />
          </ActionPanel>
        }
      />
    );
  }

  return (
    <List isLoading={isLoading}>
      <List.Section title="Rate Limits">
        {windows.map((item) => {
          const remaining = getRemainingPercent(item.window);
          return (
            <List.Item
              key={item.id}
              icon={getProgressIcon(remaining / 100, getRemainingColor(remaining))}
              title={item.label}
              subtitle={
                item.window.resetsAt
                  ? `Resets in ${formatTimeUntil(item.window.resetsAt)} · ${formatResetDate(item.window.resetsAt)}`
                  : undefined
              }
              accessories={[
                { tag: { value: `${formatPercent(remaining)}% remaining`, color: getRemainingColor(remaining) } },
              ]}
              actions={
                <ActionPanel>
                  {refreshAction}
                  <Action.OpenInBrowser
                    title="Open Codex Usage Settings"
                    url="https://chatgpt.com/codex/settings/usage"
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
      {activity ? (
        <List.Section title="Sessions">
          <List.Item
            icon={Icon.Clock}
            title="Today"
            subtitle={`${activity.todayCount} session${activity.todayCount !== 1 ? "s" : ""}`}
            actions={<ActionPanel>{refreshAction}</ActionPanel>}
          />
          <List.Item
            icon={Icon.Calendar}
            title="Last 7 Days"
            subtitle={`${activity.weekCount} session${activity.weekCount !== 1 ? "s" : ""}`}
            actions={<ActionPanel>{refreshAction}</ActionPanel>}
          />
          <List.Item
            icon={Icon.Bubble}
            title="Latest Session"
            subtitle={activity.latestTitle}
            accessories={[{ text: formatTimeAgo(activity.latestUpdatedAt) }]}
            actions={<ActionPanel>{refreshAction}</ActionPanel>}
          />
        </List.Section>
      ) : null}
    </List>
  );
}

function fetchCodexUsage(): Promise<UsageData> {
  return new Promise((resolve, reject) => {
    const codexExecutable = resolveCodexExecutable();
    const child = spawn(codexExecutable, ["app-server"], {
      env: {
        ...process.env,
        PATH: getExtendedPath(),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let rateLimits: GetAccountRateLimitsResponse | null = null;
    let threads: Thread[] = [];
    let threadListFinished = false;
    let activityTimeout: NodeJS.Timeout | undefined;

    const timeout = setTimeout(() => {
      finish(new Error("Timed out while waiting for Codex rate limits."));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";

      for (const line of lines) {
        handleRpcLine(line);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        finish(
          new Error(
            `Could not find the Codex CLI. Checked: ${CODEX_EXECUTABLE_CANDIDATES.join(", ")}. Install Codex or add it to a standard PATH location like /opt/homebrew/bin/codex.`,
          ),
        );
        return;
      }

      finish(error);
    });

    child.on("exit", (code) => {
      if (!settled && code !== 0) {
        finish(new Error(`Codex app-server exited with code ${code}.${formatStderr(stderr)}`));
      }
    });

    child.stdin.write(
      JSON.stringify({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "raycast-codex-usage", version: "0.0.0" } },
      }) + "\n",
    );

    function handleRpcLine(line: string) {
      let message: RpcResponse;

      try {
        message = JSON.parse(line) as RpcResponse;
      } catch {
        return;
      }

      if (message.id === 1) {
        child.stdin.write(JSON.stringify({ id: 2, method: "account/rateLimits/read" }) + "\n");
        child.stdin.write(
          JSON.stringify({
            id: 3,
            method: "thread/list",
            params: {
              limit: 50,
              sortKey: "updated_at",
              sortDirection: "desc",
              archived: false,
              sourceKinds: ["cli", "vscode", "exec", "appServer"],
            },
          }) + "\n",
        );
        return;
      }

      if (message.id !== 2 && message.id !== 3) {
        return;
      }

      if (message.error) {
        if (message.id === 2) {
          finish(new Error(`${message.error.message}.${formatStderr(stderr)}`));
        }
        if (message.id === 3) {
          threadListFinished = true;
          if (rateLimits) {
            finish(null, { rateLimits, threads });
          }
        }
        return;
      }

      if (!message.result && message.id === 2) {
        finish(new Error("Codex returned an empty rate-limit response."));
        return;
      }

      if (message.id === 2) {
        rateLimits = message.result as GetAccountRateLimitsResponse;
        activityTimeout = setTimeout(() => {
          if (rateLimits) {
            finish(null, { rateLimits, threads });
          }
        }, 1500);
      }

      if (message.id === 3) {
        threads = ((message.result as ThreadListResponse | undefined)?.data ?? []).filter(Boolean);
        threadListFinished = true;
      }

      if (rateLimits && threadListFinished) {
        finish(null, { rateLimits, threads });
      }
    }

    function finish(error: Error | null, result?: UsageData) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      clearTimeout(activityTimeout);
      child.kill();

      if (error) {
        showToast({ style: Toast.Style.Failure, title: "Failed to load Codex usage", message: error.message });
        reject(error);
        return;
      }

      resolve(result as UsageData);
    }
  });
}

function resolveCodexExecutable(): string {
  for (const candidate of CODEX_EXECUTABLE_CANDIDATES) {
    if (candidate !== "codex" && existsSync(candidate)) {
      return candidate;
    }
  }

  return "codex";
}

function getExtendedPath(): string {
  return [
    process.env.PATH,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    join(homedir(), ".local/bin"),
    join(homedir(), ".npm-global/bin"),
  ]
    .filter(Boolean)
    .join(":");
}

function getCodexWindows(response: GetAccountRateLimitsResponse): DisplayWindow[] {
  const snapshot = getCodexSnapshot(response);
  const windows: DisplayWindow[] = [];

  const fiveHourWindow = [snapshot.primary, snapshot.secondary].find((window) => window?.windowDurationMins === 300);
  const weeklyWindow = [snapshot.primary, snapshot.secondary].find((window) => window?.windowDurationMins === 10080);

  if (fiveHourWindow) {
    windows.push({ id: "5h", label: "5H Limit", window: fiveHourWindow });
  }

  if (weeklyWindow) {
    windows.push({ id: "weekly", label: "Weekly Limit", window: weeklyWindow });
  }

  return windows;
}

function getCodexSnapshot(response: GetAccountRateLimitsResponse): RateLimitSnapshot {
  return response.rateLimitsByLimitId?.codex ?? response.rateLimits;
}

function getRecentActivity(threads: Thread[]) {
  const [latest] = threads;

  if (!latest) {
    return null;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
  const weekStart = Date.now() / 1000 - 7 * 24 * 60 * 60;

  return {
    latestTitle: latest.name || latest.preview || getDirectoryName(latest.cwd) || "Untitled session",
    latestUpdatedAt: latest.updatedAt,
    todayCount: threads.filter((thread) => thread.updatedAt >= todayStart).length,
    weekCount: threads.filter((thread) => thread.updatedAt >= weekStart).length,
    totalCount: threads.length,
  };
}

function getRemainingColor(remainingPercent: number): Color {
  if (remainingPercent <= 20) {
    return Color.Red;
  }

  if (remainingPercent < 50) {
    return Color.Orange;
  }

  return Color.Green;
}

function getRemainingPercent(window: RateLimitWindow): number {
  return clampPercent(100 - window.usedPercent);
}

function formatResetDate(timestampSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(new Date(timestampSeconds * 1000));
}

function formatTimeUntil(timestampSeconds: number): string {
  const totalMinutes = Math.max(0, Math.round((timestampSeconds * 1000 - Date.now()) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }

  return `${minutes}min`;
}

function formatTimeAgo(timestampSeconds: number): string {
  const diffMinutes = Math.round((timestampSeconds * 1000 - Date.now()) / 60000);
  const absMinutes = Math.abs(diffMinutes);

  if (absMinutes < 60) {
    return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  const absHours = Math.abs(diffHours);

  if (absHours < 48) {
    return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(diffHours, "hour");
  }

  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(Math.round(diffHours / 24), "day");
}

function getDirectoryName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "";
}

function formatPercent(value: number): string {
  return clampPercent(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function formatStderr(stderr: string): string {
  const meaningfulLine = stderr
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("WARNING:"));

  return meaningfulLine ? ` ${meaningfulLine}` : "";
}
