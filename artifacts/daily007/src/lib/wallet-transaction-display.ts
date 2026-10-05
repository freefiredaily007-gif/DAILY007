type WalletTransactionDisplayItem = {
  amount?: unknown;
  balanceAfter?: unknown;
  createdAt?: unknown;
  description?: unknown;
  reason?: unknown;
};

export function walletTransactionDescription(item: WalletTransactionDisplayItem): string {
  if (typeof item.description === "string" && item.description.trim()) {
    return item.description.trim();
  }
  if (item.reason === "tournament_cancel_refund") {
    return "Entry fee refunded (tournament cancelled)";
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
    : [description, `${amount} coins`];
  if (typeof item.createdAt === "string" && item.createdAt.trim()) {
    parts.push(`Date: ${item.createdAt.slice(0, 16).replace("T", " ")}`);
  }
  if (item.balanceAfter !== undefined && item.balanceAfter !== null) {
    parts.push(`Balance after: ${String(item.balanceAfter)} coins`);
  }
  return `${parts.join(". ")}.`;
}