type WalletTransactionDisplayItem = {
  amount?: unknown;
  balanceAfter?: unknown;
  createdAt?: unknown;
  description?: unknown;
  details?: unknown;
  isRequest?: unknown;
  reason?: unknown;
  requestType?: unknown;
};

export type WalletTransactionFilter = "all" | "deposits" | "withdrawals" | "refunds";

const WALLET_REFUND_REASONS = new Set([
  "registration_refund",
  "tournament_cancel_refund",
  "withdrawal_rejected_refund",
  "withdrawal_deleted_refund",
]);

export function walletTransactionMatchesFilter(
  item: WalletTransactionDisplayItem,
  filter: WalletTransactionFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "deposits") {
    return (item.isRequest === true && item.requestType === "payment") ||
      item.reason === "payment_approved";
  }
  if (filter === "withdrawals") {
    return (item.isRequest === true && item.requestType === "withdrawal") ||
      item.reason === "withdrawal_reserved";
  }
  return typeof item.reason === "string" && WALLET_REFUND_REASONS.has(item.reason);
}

function leaderboardRewardDescription(item: WalletTransactionDisplayItem): string | null {
  const details = item.details && typeof item.details === "object"
    ? item.details as Record<string, unknown>
    : null;
  const cycleType = details?.cycleType;
  const rank = Number(details?.rank);
  if (
    (cycleType === "weekly" || cycleType === "monthly") &&
    Number.isSafeInteger(rank) &&
    rank > 0
  ) {
    const cycle = cycleType === "weekly" ? "Weekly" : "Monthly";
    return `${cycle} Leaderboard Rank #${rank} Reward`;
  }
  return typeof item.reason === "string" &&
      /^(weekly|monthly) leaderboard rank #\d+ reward$/i.test(item.reason.trim())
    ? item.reason.trim()
    : null;
}

export function walletTransactionIsLeaderboardReward(item: WalletTransactionDisplayItem): boolean {
  return leaderboardRewardDescription(item) !== null;
}

export function walletTransactionDescription(item: WalletTransactionDisplayItem): string {
  const leaderboardDescription = leaderboardRewardDescription(item);
  if (leaderboardDescription) return leaderboardDescription;
  if (typeof item.description === "string" && item.description.trim()) {
    return item.description.trim();
  }
  if (item.reason === "tournament_cancel_refund") {
    return "Entry fee refunded (tournament cancelled)";
  }
  if (item.reason === "video_watch_reward") {
    return "Video watch reward";
  }
  return Number(item.amount) > 0 ? "Coins added" : "Tournament entry";
}

export function walletTransactionAmount(item: WalletTransactionDisplayItem): string {
  const amount = item.amount ?? 0;
  return `${Number(amount) > 0 ? "+" : ""}${amount}`;
}

export function walletTransactionAccessibilityLabel(item: WalletTransactionDisplayItem): string {
  const description = walletTransactionDescription(item);
  const amount = walletTransactionAmount(item);
  const parts = item.reason === "tournament_cancel_refund"
    ? [description, `${amount} coins credited`]
    : walletTransactionIsLeaderboardReward(item)
      ? [description, `${amount} coins credited`]
    : [description, `${amount} coins`];
  if (typeof item.createdAt === "string" && item.createdAt.trim()) {
    parts.push(`Date: ${item.createdAt.slice(0, 16).replace("T", " ")}`);
  }
  if (item.balanceAfter !== undefined && item.balanceAfter !== null) {
    parts.push(`Balance after: ${String(item.balanceAfter)} coins`);
  }
  return `${parts.join(". ")}.`;
}

export function walletRejectedDepositReasonText(reviewReason: unknown): string {
  const reason = typeof reviewReason === "string"
    ? reviewReason.trim().replace(/\s+/g, " ")
    : "";
  return reason || "No rejection reason was provided.";
}

export function walletRejectedDepositAccessibilityLabel(item: {
  rupeeAmount: string;
  coins: unknown;
  createdAt?: unknown;
  reference?: unknown;
  reviewReason?: unknown;
}): string {
  const coinAmount = Number(item.coins);
  const coinLabel = Number.isFinite(coinAmount)
    ? new Intl.NumberFormat("en-IN").format(coinAmount)
    : String(item.coins ?? 0);
  const parts = [
    "Deposit request",
    "Status: Rejected",
    `Original rupee amount: ${item.rupeeAmount}`,
    `Coin amount: ${coinLabel} coins`,
  ];
  const createdAt = String(item.createdAt ?? "").slice(0, 16).replace("T", " ");
  if (createdAt) parts.push(`Date: ${createdAt}`);
  const reference = String(item.reference ?? "").trim();
  if (reference) parts.push(`UTR: ${reference}`);
  parts.push(`Rejection reason: ${walletRejectedDepositReasonText(item.reviewReason)}`);
  const label = parts.join(". ");
  return `${label}${/[.!?]$/.test(label) ? "" : "."}`;
}