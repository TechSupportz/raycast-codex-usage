import { Action, ActionPanel, Color, Icon, List, openExtensionPreferences } from "@raycast/api";
import { Fragment, useState, type ReactElement } from "react";
import { getProgressIcon } from "@raycast/utils";
import { useAccounts, type AccountState } from "./use-accounts";
import { formatResetTimeRemaining, parseResetExpiry } from "./reset-expiry";
import { getBranding } from "./providers/branding";
import type { Account, ResetCredit, ResetCreditsResponse, UsageWindow } from "./providers/types";

export default function Command() {
  const { states, isLoading, refresh, initialSelectedId } = useAccounts();
  // Controlled from the first render onwards, so nothing re-selects a row as
  // the accounts stream in one by one.
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);

  const refreshAction = (
    <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} shortcut={{ modifiers: ["cmd"], key: "r" }} />
  );

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={states.length > 0}
      searchBarPlaceholder="Filter accounts…"
      selectedItemId={selectedId}
      onSelectionChange={(id) => setSelectedId(id ?? undefined)}
    >
      {states.length === 0 ? (
        <List.EmptyView
          icon={Icon.Gauge}
          title="No Accounts Configured"
          description="Add a Codex home directory, or turn on Claude Code, in this extension's preferences."
          actions={
            <ActionPanel>
              <Action title="Open Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
            </ActionPanel>
          }
        />
      ) : null}
      {states.map((state) => (
        <AccountItem key={state.config.id} state={state} refreshAction={refreshAction} />
      ))}
    </List>
  );
}

function AccountItem({ state, refreshAction }: { state: AccountState; refreshAction: ReactElement }) {
  const { config, account, isStale } = state;
  const branding = getBranding(config.provider);
  const resets = account?.resets ? getAvailableResets(account.resets) : [];

  return (
    <List.Item
      id={config.id}
      icon={{ source: branding.icon, tintColor: getBrandTint(account) }}
      title={config.label}
      keywords={[branding.name, account?.email ?? "", formatPlan(account?.plan ?? null) ?? ""]}
      accessories={getAccessories(account, isStale)}
      detail={<AccountDetail state={state} resets={resets} />}
      actions={
        <ActionPanel>
          {refreshAction}
          {account?.email ? (
            <Action.CopyToClipboard title="Copy Account Email" content={account.email} icon={Icon.Envelope} />
          ) : null}
          <Action title="Open Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />
        </ActionPanel>
      }
    />
  );
}

/**
 * The list is narrow in detail mode, so the accessory carries only the single
 * most-constrained window - enough to triage without opening each account.
 */
function getAccessories(account: Account | null, isStale: boolean): List.Item.Accessory[] {
  if (account === null) {
    return [{ tag: { value: "…", color: Color.SecondaryText } }];
  }

  if (account.failure) {
    return [
      {
        icon: {
          source: account.failure.kind === "expired" ? Icon.Key : Icon.Warning,
          tintColor: account.failure.kind === "expired" ? Color.Yellow : Color.Red,
        },
        tooltip: account.failure.message,
      },
    ];
  }

  const tightest = getTightestWindow(account.windows);

  if (!tightest) {
    return [];
  }

  const remaining = getRemaining(tightest);
  const accessories: List.Item.Accessory[] = [
    {
      icon: getProgressIcon(remaining / 100, getRemainingColor(remaining)),
      tag: { value: `${formatPercent(remaining)}%`, color: getRemainingColor(remaining) },
      tooltip: `${tightest.label}: ${formatPercent(remaining)}% left`,
    },
  ];

  if (isStale) {
    accessories.unshift({
      icon: Icon.ArrowClockwise,
      tooltip: "Showing the last known values while refreshing…",
    });
  }

  return accessories;
}

function AccountDetail({ state, resets }: { state: AccountState; resets: ResetCredit[] }) {
  const { config, account } = state;
  const branding = getBranding(config.provider);

  return (
    <List.Item.Detail
      markdown={buildMarkdown(state)}
      metadata={
        <List.Item.Detail.Metadata>
          <WindowRows state={state} />
          {account && !account.failure && account.windows.length > 0 ? <List.Item.Detail.Metadata.Separator /> : null}
          <List.Item.Detail.Metadata.Label title="Provider" text={branding.name} icon={{ source: branding.icon }} />
          {account?.plan && formatPlan(account.plan) ? (
            <List.Item.Detail.Metadata.Label title="Plan" text={formatPlan(account.plan) ?? ""} icon={Icon.Star} />
          ) : null}
          {account?.email ? (
            <List.Item.Detail.Metadata.Label title="Account" text={account.email} icon={Icon.Person} />
          ) : null}
          <ResetRows credits={resets} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

/**
 * One tag row per window, plus the reset time beneath it. While an account is
 * still loading we list the windows this provider usually returns, so the pane
 * keeps its shape instead of jumping when the real response lands.
 */
function WindowRows({ state: { config, account } }: { state: AccountState }) {
  if (account === null) {
    return (
      <>
        {getBranding(config.provider).skeletonWindows.map((label) => (
          <List.Item.Detail.Metadata.TagList key={label} title={label}>
            <List.Item.Detail.Metadata.TagList.Item text="Checking…" color={Color.SecondaryText} />
          </List.Item.Detail.Metadata.TagList>
        ))}
      </>
    );
  }

  if (account.failure) {
    return (
      <List.Item.Detail.Metadata.TagList title="Status">
        <List.Item.Detail.Metadata.TagList.Item
          text={account.failure.kind === "expired" ? "Signed Out" : "Unavailable"}
          color={account.failure.kind === "expired" ? Color.Yellow : Color.Red}
        />
      </List.Item.Detail.Metadata.TagList>
    );
  }

  return (
    <>
      {account.windows.map((window) => {
        const remaining = getRemaining(window);

        return (
          <Fragment key={window.id}>
            <List.Item.Detail.Metadata.TagList title={window.label}>
              <List.Item.Detail.Metadata.TagList.Item
                text={`${formatPercent(remaining)}% left`}
                color={getRemainingColor(remaining)}
              />
            </List.Item.Detail.Metadata.TagList>
            {window.resetsAt ? (
              <List.Item.Detail.Metadata.Label
                title="Resets"
                text={`in ${formatTimeUntil(window.resetsAt)} · ${formatResetDate(window.resetsAt)}`}
              />
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}

/** Only states that need a sentence get prose; healthy accounts are metadata alone. */
function buildMarkdown({ config, account }: AccountState): string | undefined {
  if (account?.failure) {
    return [`# ${config.label}`, account.failure.message].join("\n\n");
  }

  if (account && account.windows.length === 0) {
    return [`# ${config.label}`, "This account reported no usage limits."].join("\n\n");
  }

  return undefined;
}

/**
 * Every banked reset, soonest to expire first. They were behind a pushed view
 * when the pane was busier; there is room for them here now.
 */
function ResetRows({ credits }: { credits: ResetCredit[] }) {
  if (credits.length === 0) {
    return null;
  }

  return (
    <>
      <List.Item.Detail.Metadata.Separator />
      <List.Item.Detail.Metadata.TagList title="Usage Resets">
        <List.Item.Detail.Metadata.TagList.Item text={`${credits.length} available`} color={Color.Blue} />
      </List.Item.Detail.Metadata.TagList>
      {credits.map((credit, index) => (
        <List.Item.Detail.Metadata.TagList key={credit.id} title={`Reset ${index + 1}`}>
          <List.Item.Detail.Metadata.TagList.Item
            text={formatExpiryDate(credit.expires_at)}
            color={Color.SecondaryText}
          />
          <List.Item.Detail.Metadata.TagList.Item
            text={formatTimeRemainingTag(credit.expires_at)}
            color={getResetExpiryColor(credit.expires_at)}
          />
        </List.Item.Detail.Metadata.TagList>
      ))}
    </>
  );
}

function getTightestWindow(windows: UsageWindow[]): UsageWindow | null {
  return windows.reduce<UsageWindow | null>(
    (tightest, window) => (tightest === null || getRemaining(window) < getRemaining(tightest) ? window : tightest),
    null,
  );
}

function getRemaining(window: UsageWindow): number {
  return clampPercent(100 - window.usedPercent);
}

function getBrandTint(account: Account | null): Color | undefined {
  if (account === null) {
    return Color.SecondaryText;
  }

  if (!account.failure) {
    return undefined;
  }

  return account.failure.kind === "expired" ? Color.Yellow : Color.Red;
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

function formatTimeRemainingTag(date: string): string {
  const remaining = formatResetTimeRemaining(date);

  return remaining === "Expired" ? remaining : `${remaining} left`;
}

function formatExpiryDate(date: string): string {
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
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
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
  return `${Math.round(clampPercent(value))}`;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
