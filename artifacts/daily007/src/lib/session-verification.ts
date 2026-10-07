export type SessionRestoreResult<T> =
  | { status: 'empty' }
  | { status: 'verified'; session: T }
  | { status: 'rejected' }
  | { status: 'retry'; session: T };

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

export function subscribeToSessionVerificationRecovery(
  paused: boolean,
  retry: () => void,
  network: SessionVerificationNetworkSource,
  appState: SessionVerificationAppStateSource,
): () => void {
  if (!paused) return () => {};

  let active = true;
  const retryIfOnline = (state: SessionVerificationNetworkState) => {
    if (
      active &&
      state.isConnected === true &&
      state.isInternetReachable !== false
    ) {
      retry();
    }
  };
  const networkSubscription = network.addNetworkStateListener(retryIfOnline);
  const appStateSubscription = appState.addEventListener('change', (state) => {
    if (state !== 'active') return;
    void network.getNetworkStateAsync().then(retryIfOnline).catch(() => {});
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
      return { status: 'rejected' };
    }
    return { status: 'retry', session: savedSession };
  }
}