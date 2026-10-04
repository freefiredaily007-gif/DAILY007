const previewUser = {
  id: "preview-player",
  name: "Preview Player",
  phone: "",
  gameUid: "",
  coins: 1000,
  role: "full_admin",
};

const largestTextPreviewUser = {
  ...previewUser,
  id: "largest-text-player",
  name: "Daily007 Champion With A Long Player Name",
  email: "champion.player.with.a.long.email.address@example.invalid",
  phone: "+91 98765 43210",
  gameUid: "12345678901234567890",
  coins: 123456789,
  matches: 123456,
  wins: 12345,
  kills: 987654,
  prizeCoins: 54321,
  role: "player",
};

const previewRefresh = async () => ({ user: previewUser });
const previewLogout = () => undefined;

export function useApp() {
  const largeTextPreview = Boolean(
    (globalThis as typeof globalThis & { __playerLargestTextPreview?: boolean })
      .__playerLargestTextPreview,
  );
  return {
    user: largeTextPreview ? largestTextPreviewUser : previewUser,
    refresh: previewRefresh,
    logout: previewLogout,
  };
}
