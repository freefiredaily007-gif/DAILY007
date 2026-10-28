export type SessionRestoreResult<T> =
  | { status: 'empty' }
  | { status: 'verified'; session: T }
  | { status: 'rejected'; reason?: 'blocked' }
  | { status: 'retry'; session: T };

export const BLOCKED_ACCOUNT_SESSION_NOTICE =
  'Your Daily007 account is blocked. Your saved sign-in has been cleared. Please contact an administrator to review your access.';

export type SessionExpiredReason = 'blocked';

export function isBlockedAccountError(error: unknown): boolean {
  const response = (error as {
    response?: { status?: unknown; data?: { error?: unknown } };
  } | null)?.response;
  return response?.status === 403 && response.data?.error === 'This account is blocked.';
}

export interface SessionVerificationNetworkState {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}

export interface SessionVerificationNetworkSource {
  addNetworkStateListener(
    listener: (state: SessionVerificationNetworkState) => void,
  ): { remove: () => void };
  getNetworkStateAsync(): Promise<SessionVerificationNetworkState>;
}

export interface SessionVerificationAppStateSource {
  addEventListener(
    type: 'change',
    listener: (state: string) => void,
  ): { remove: () => void };
}

export function runSingleFlight<T>(
  requestSlot: { current: Promise<T> | null },
  operation: () => Promise<T>,
): Promise<T> {
  if (requestSlot.current) return requestSlot.current;

  const request = Promise.resolve().then(operation);
  requestSlot.current = request;
  const clearRequest = () => {
    if (requestSlot.current === request) requestSlot.current = null;
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function subscribeToSessionVerificationRecovery(
  paused: boolean,
  retry: () => void,
  network: SessionVerificationNetworkSource,
  appState: SessionVerificationAppStateSource,
): () => void {
  if (!paused) return () => {};

  let active = true;
  let lastKnownOnline: boolean | null = null;
  let appWasBackgrounded = false;
  const isOnline = (state: SessionVerificationNetworkState) =>
    state.isConnected === true && state.isInternetReachable !== false;
  const retryIfOnline = (state: SessionVerificationNetworkState) => {
    if (!active) return;
    const wasOnline = lastKnownOnline;
    const online = isOnline(state);
    lastKnownOnline = online;
    if (!online) return;

    // Native network listeners can emit several online updates for one
    // reconnect. Retry only on the offline-to-online edge.
    if (wasOnline !== true) {
      retry();
    }
  };
  const networkSubscription = network.addNetworkStateListener(retryIfOnline);
  const appStateSubscription = appState.addEventListener('change', (state) => {
    if (state !== 'active') {
      if (!appWasBackgrounded) {
        appWasBackgrounded = true;
      }
      return;
    }

    void network.getNetworkStateAsync().then((networkState) => {
      if (!active) return;
      const wasOnline = lastKnownOnline;
      const online = isOnline(networkState);
      lastKnownOnline = online;
      if (!online) {
        appWasBackgrounded = false;
        return;
      }

      // A reconnect retry may run while the app is backgrounded, before APIs
      // can verify the session. Recheck once on foreground; in-flight requests
      // share the same singleflight promise.
      if (wasOnline !== true || appWasBackgrounded) {
        retry();
      }
      appWasBackgrounded = false;
    }).catch(() => {});
  });

  // Connectivity can return before either listener is attached.
  void network.getNetworkStateAsync().then(retryIfOnline).catch(() => {});

  return () => {
    active = false;
    networkSubscription.remove();
    appStateSubscription.remove();
  };
}

function isAuthenticationRejection(error: unknown): boolean {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return status === 401 || status === 403;
}

export async function restoreDaily007Session<T extends { token?: string }>(
  readStoredSession: () => Promise<T | null>,
  verifyWithApi: () => Promise<T>,
  updateStoredSession: (session: T | null) => void | Promise<void>,
): Promise<SessionRestoreResult<T>> {
  const savedSession = await readStoredSession();
  if (!savedSession) return { status: 'empty' };

  try {
    const verified = await verifyWithApi();
    const session = { ...verified, token: savedSession.token };
    await updateStoredSession(session);
    return { status: 'verified', session };
  } catch (error) {
    if (isAuthenticationRejection(error)) {
      await updateStoredSession(null);
      return isBlockedAccountError(error)
        ? { status: 'rejected', reason: 'blocked' }
        : { status: 'rejected' };
    }
    return { status: 'retry', session: savedSession };
  }
}