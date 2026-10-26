const TOURNAMENT_ADMIN_SCREEN_KEYS = new Set(["tournaments", "killEarn", "registrations", "knockout"]);

function mergeAccessRefreshResponse<T extends { token?: string }>(
  previous: T,
  account: Partial<T>,
): T {
  return { ...previous, ...account, token: previous.token } as T;
}

export async function refreshUserAccountAccess<T extends { token?: string }>(
  previous: T,
  fetchAccount: () => Promise<Partial<T>>,
  commit: (updated: T) => void | boolean | Promise<void | boolean>,
  isCurrent: () => boolean = () => true,
): Promise<T | null> {
  const account = await fetchAccount();
  if (!isCurrent()) return null;
  const updated = mergeAccessRefreshResponse(previous, account);
  if (await commit(updated) === false) return null;
  return updated;
}

export async function refreshUserAccountAccessSafely<T extends { token?: string }>(
  previous: T,
  fetchAccount: () => Promise<Partial<T>>,
  commit: (updated: T) => void | boolean | Promise<void | boolean>,
  rejectSession: (error: unknown) => void,
  isCurrent: () => boolean = () => true,
): Promise<T | null> {
  try {
    return await refreshUserAccountAccess(previous, fetchAccount, commit, isCurrent);
  } catch (error) {
    const status = (error as { response?: { status?: number } } | null)?.response?.status;
    if ((status === 401 || status === 403) && isCurrent()) rejectSession(error);
    return null;
  }
}

export function refreshAccessIfActive(state: string, refresh: () => unknown): void {
  if (state === "active") void refresh();
}

export interface AccountAccessNetworkState {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}

export interface AccountAccessNetworkSource {
  addNetworkStateListener(
    listener: (state: AccountAccessNetworkState) => void,
  ): { remove: () => void };
  getNetworkStateAsync(): Promise<AccountAccessNetworkState>;
}

export function subscribeToAccountAccessReconnect(
  isAppActive: () => boolean,
  refreshOnReconnect: () => void,
  network: AccountAccessNetworkSource,
): () => void {
  let active = true;
  let previousConnected: boolean | null = null;
  let networkEventCount = 0;
  const onNetworkState = (state: AccountAccessNetworkState) => {
    if (!active) return;
    const connected = state.isConnected === true && state.isInternetReachable !== false;
    if (connected && previousConnected !== true && isAppActive()) refreshOnReconnect();
    previousConnected = connected;
    networkEventCount += 1;
  };
  const subscription = network.addNetworkStateListener(onNetworkState);

  void network.getNetworkStateAsync().then((state) => {
    if (!active || networkEventCount > 0) return;
    previousConnected = state.isConnected === true && state.isInternetReachable !== false;
  }).catch(() => {});

  return () => {
    active = false;
    subscription.remove();
  };
}

export function refreshAccessAfterPending<T>(
  pendingRequest: Promise<T> | null,
  resumeRequest: { current: Promise<T> | null },
  refresh: () => Promise<T>,
): Promise<T> {
  if (resumeRequest.current) return resumeRequest.current;

  const request = pendingRequest
    ? pendingRequest.then(refresh, refresh)
    : refresh();
  resumeRequest.current = request;
  void request.then(
    () => {
      if (resumeRequest.current === request) resumeRequest.current = null;
    },
    () => {
      if (resumeRequest.current === request) resumeRequest.current = null;
    },
  );
  return request;
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
