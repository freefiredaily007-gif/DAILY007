const TOURNAMENT_ADMIN_SCREEN_KEYS = new Set(["tournaments", "registrations"]);

function mergeAccessRefreshResponse<T extends { token?: string }>(
  previous: T,
  account: Partial<T>,
): T {
  return { ...previous, ...account, token: previous.token } as T;
}

export async function refreshUserAccountAccess<T extends { token?: string }>(
  previous: T,
  fetchAccount: () => Promise<Partial<T>>,
  commit: (updated: T) => void,
): Promise<T> {
  const account = await fetchAccount();
  const updated = mergeAccessRefreshResponse(previous, account);
  commit(updated);
  return updated;
}

export function rootNavigationForRole(role?: string): "Admin" | "Tabs" {
  return role === "admin" || role === "tournament_admin" ? "Admin" : "Tabs";
}

export function adminNavigationForRole<T extends { key: string }>(
  role: string | undefined,
  selectedScreen: string,
  navItems: readonly T[],
): { activeScreen: string; visibleNavKeys: string[] } {
  const tournamentAdmin = role === "tournament_admin";
  const visibleNavKeys = role === "admin"
    ? navItems.map(({ key }) => key)
    : tournamentAdmin
      ? navItems
        .filter(({ key }) => TOURNAMENT_ADMIN_SCREEN_KEYS.has(key))
        .map(({ key }) => key)
      : [];

  return {
    activeScreen: tournamentAdmin &&
      !TOURNAMENT_ADMIN_SCREEN_KEYS.has(selectedScreen)
      ? "tournaments"
      : selectedScreen,
    visibleNavKeys,
  };
}

export function canNavigateAdminScreen(role: string | undefined, nextScreen: string): boolean {
  return role === "admin" ||
    (role === "tournament_admin" && TOURNAMENT_ADMIN_SCREEN_KEYS.has(nextScreen));
}
