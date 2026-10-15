export type WalletHistoryState<T> = {
  userId: string | null;
  items: T[];
  cursor: string | null;
};

export function emptyWalletHistoryState<T>(userId: string | null): WalletHistoryState<T> {
  return { userId, items: [], cursor: null };
}

export function walletHistoryForUser<T>(
  history: WalletHistoryState<T>,
  userId: string | null,
): WalletHistoryState<T> {
  return history.userId === userId ? history : emptyWalletHistoryState(userId);
}
