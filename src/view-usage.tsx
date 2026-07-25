import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import type { ReactElement } from "react";
import { getProgressIcon, usePromise } from "@raycast/utils";
import { fetchAllAccounts } from "./usage";
import { formatResetTimeRemaining, parseResetExpiry } from "./reset-expiry";
import type { Account, ResetCredit, ResetCreditsResponse, UsageWindow } from "./providers/types";

export default function Command() {
  const { data, error, isLoading, revalidate } = usePromise(fetchAllAccounts);
  const accounts = data ?? [];
  const refresh = () => void revalidate();

  const refreshAction = (
    <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} shortcut={{ modifiers: ["cmd"], key: "r" }} />
  );

  if (isLoading && !data) {
    return (
      <List isLoading>
        <List.Section title="Loading">
          <List.Item icon={getProgressIcon(0)} title="Usage" subtitle="Reading your accounts…" />
        </List.Section>
      </List>
    );
  }

  return (
    <List isLoading={isLoading}>
      {error ? (
        <List.Section title="Error">
          <List.Item
            icon={{ source: Icon.Warning, tintColor: Color.Red }}
            title="Could not load usage"
            subtitle={error.message}
            actions={<ActionPanel>{refreshAction}</ActionPanel>}
          />
        </List.Section>
      ) : null}
      {accounts.length === 0 && !error ? (
        <List.EmptyView
          icon={Icon.Gauge}
          title="No Accounts Configured"
          description="Add a Codex home directory in this extension's preferences."
        />
      ) : null}
      {accounts.map((account) => (
        <AccountSection key={account.id} account={account} refreshAction={refreshAction} />
      ))}
    </List>
  );
}

function AccountSection({ account, refreshAction }: { account: Account; refreshAction: ReactElement }) {
  const actions = (
    <ActionPanel>
      {refreshAction}
      {account.email ? (
        <Action.CopyToClipboard title="Copy Account Email" content={account.email} icon={Icon.Envelope} />
      ) : null}
    </ActionPanel>
  );

  return (
    <List.Section title={account.label} subtitle={formatPlan(account.plan) ?? undefined}>
      {account.failure ? (
        <List.Item
          icon={{
            source: account.failure.kind === "expired" ? Icon.Key : Icon.Warning,
            tintColor: account.failure.kind === "expired" ? Color.Yellow : Color.Red,
          }}
          title={account.failure.kind === "expired" ? "Signed Out" : "Unavailable"}
          subtitle={account.failure.message}
          actions={actions}
        />
      ) : null}
      {account.windows.map((window) => (
        <WindowItem key={window.id} window={window} actions={actions} />
      ))}
      {account.resets ? <ResetsItem resets={account.resets} refreshAction={refreshAction} /> : null}
    </List.Section>
  );
}

function WindowItem({ window, actions }: { window: UsageWindow; actions: ReactElement }) {
  const remaining = clampPercent(100 - window.usedPercent);

  return (
    <List.Item
      icon={getProgressIcon(remaining / 100, getRemainingColor(remaining))}
      title={window.label}
      subtitle={
        window.resetsAt
          ? `Resets in ${formatTimeUntil(window.resetsAt)} · ${formatResetDate(window.resetsAt)}`
          : undefined
      }
      accessories={[{ tag: { value: `${formatPercent(remaining)}% remaining`, color: getRemainingColor(remaining) } }]}
      actions={actions}
    />
  );
}

function ResetsItem({ resets, refreshAction }: { resets: ResetCreditsResponse; refreshAction: ReactElement }) {
  const available = getAvailableResets(resets);
  const earliest = available[0];

  return (
    <List.Item
      icon={Icon.Replace}
      title="Usage Resets"
      subtitle={earliest ? `Earliest expires ${formatCompactDateTime(earliest.expires_at)}` : "No available resets"}
      accessories={[
        { tag: { value: formatResetCount(resets.available_count), color: Color.Blue } },
        ...(earliest
          ? [
              {
                tag: {
                  value: formatTimeRemainingTag(earliest.expires_at),
                  color: getResetExpiryColor(earliest.expires_at),
                },
              },
            ]
          : []),
      ]}
      actions={
        <ActionPanel>
          <Action.Push title="View Resets" icon={Icon.List} target={<ResetsDetailView credits={available} />} />
          {refreshAction}
        </ActionPanel>
      }
    />
  );
}

function ResetsDetailView({ credits }: { credits: ResetCredit[] }) {
  return (
    <List navigationTitle="Usage Resets" isShowingDetail={credits.length > 0}>
      {credits.length === 0 ? <List.EmptyView icon={Icon.Repeat} title="No Available Resets" /> : null}
      <List.Section title={formatResetCount(credits.length)}>
        {credits.map((credit, index) => (
          <List.Item
            key={credit.id}
            icon={Icon.Repeat}
            title={`Reset ${index + 1}`}
            accessories={[
              {
                tag: {
                  value: formatTimeRemainingTag(credit.expires_at),
                  color: getResetExpiryColor(credit.expires_at),
                },
              },
            ]}
            detail={<ResetDetail credit={credit} index={index} />}
          />
        ))}
      </List.Section>
    </List>
  );
}

function ResetDetail({ credit, index }: { credit: ResetCredit; index: number }) {
  const markdown = [
    `## Reset ${index + 1}`,
    `**${credit.title || "Rate Limit Reset"}**`,
    credit.description || "One rate limit reset is available.",
    "---",
    "### Remaining",
    formatTimeRemainingTag(credit.expires_at),
    "### Granted",
    formatDateTime(credit.granted_at),
    "### Expires",
    formatDateTime(credit.expires_at),
  ].join("\n\n");

  return <List.Item.Detail markdown={markdown} />;
}

function getAvailableResets(response: ResetCreditsResponse): ResetCredit[] {
  return response.credits
    .filter((credit) => credit.status === "available")
    .sort((a, b) => parseResetExpiry(a.expires_at) - parseResetExpiry(b.expires_at));
}

function formatPlan(plan: string | null): string | null {
  if (!plan || plan === "unknown") {
    return null;
  }

  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function formatResetCount(count: number): string {
  return `${count} ${count === 1 ? "reset" : "resets"}`;
}

function formatTimeRemainingTag(date: string): string {
  const remaining = formatResetTimeRemaining(date);

  return remaining === "Expired" ? remaining : `${remaining} left`;
}

function formatDateTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parseResetExpiry(date));
}

function formatCompactDateTime(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(parseResetExpiry(date));
}

function getResetExpiryColor(date: string): Color {
  const daysRemaining = (parseResetExpiry(date) - Date.now()) / (24 * 60 * 60 * 1000);

  if (daysRemaining < 7) {
    return Color.Red;
  }

  return daysRemaining <= 14 ? Color.Yellow : Color.Green;
}

function getRemainingColor(remainingPercent: number): Color {
  if (remainingPercent <= 20) {
    return Color.Red;
  }

  return remainingPercent < 50 ? Color.Yellow : Color.Green;
}

function formatResetDate(timestampMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(new Date(timestampMs));
}

function formatTimeUntil(timestampMs: number): string {
  const totalMinutes = Math.max(0, Math.round((timestampMs - Date.now()) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatPercent(value: number): string {
  return clampPercent(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
