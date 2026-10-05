type WalletTransactionDisplayItem = {
  amount?: unknown;
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