export type FocusedRequestResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

type RefreshScheduler = {
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
};

export function createFocusedRefreshCoalescer(
  scheduler: RefreshScheduler = {},
  delayMs = 250,
  recoveryTimeoutMs = 5_000,
) {
  const schedule = scheduler.setTimeout ??
    ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const cancel = scheduler.clearTimeout ??
    ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let focused = false;
  let timer: unknown | null = null;
  let recoveryTimer: unknown | null = null;
  let pendingRefresh: (() => void | Promise<void>) | null = null;
  let refreshesInFlight = 0;
  let recoveryUsed = false;
  let focusRevision = 0;

  const clearTimer = () => {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  };
  const clearRecoveryTimer = () => {
    if (recoveryTimer === null) return;
    cancel(recoveryTimer);
    recoveryTimer = null;
  };
  const cancelPending = () => {
    clearTimer();
    clearRecoveryTimer();
    pendingRefresh = null;
  };

  const startRefresh = (refresh: () => void | Promise<void>) => {
    const currentFocusRevision = focusRevision;
    refreshesInFlight += 1;
    void (async () => {
      try {
        await refresh();
      } finally {
        if (currentFocusRevision !== focusRevision) return;
        refreshesInFlight = Math.max(0, refreshesInFlight - 1);
        if (refreshesInFlight === 0) {
          clearRecoveryTimer();
          recoveryUsed = false;
          if (focused && pendingRefresh && timer === null) flush();
        } else if (refreshesInFlight === 1) {
          recoveryUsed = false;
          if (focused && pendingRefresh && timer === null) scheduleRecovery();
        }
      }
    })();
  };

  const startPending = (isRecovery = false) => {
    if (!focused || !pendingRefresh) return;
    if (refreshesInFlight === 0) recoveryUsed = false;
    if (isRecovery) recoveryUsed = true;
    const refresh = pendingRefresh;
    pendingRefresh = null;
    startRefresh(refresh);
  };

  // Recover with one overlap at a time; a third request waits until one flight settles.
  const scheduleRecovery = () => {
    if (
      !focused ||
      !pendingRefresh ||
      refreshesInFlight !== 1 ||
      recoveryUsed ||
      recoveryTimer !== null
    ) return;
    recoveryTimer = schedule(() => {
      recoveryTimer = null;
      if (!focused || refreshesInFlight !== 1 || !pendingRefresh || recoveryUsed) return;
      clearTimer();
      startPending(true);
    }, recoveryTimeoutMs);
  };

  function flush() {
    if (!focused || !pendingRefresh) return;
    if (refreshesInFlight === 0) {
      clearRecoveryTimer();
      startPending();
      return;
    }
    if (refreshesInFlight === 1) scheduleRecovery();
  }

  return {
    setFocused(nextFocused: boolean) {
      if (focused === nextFocused) return;
      focused = nextFocused;
      focusRevision += 1;
      if (!focused) {
        cancelPending();
        refreshesInFlight = 0;
        recoveryUsed = false;
      }
    },

    request(refresh: () => void | Promise<void>): boolean {
      if (!focused) return false;
      pendingRefresh = refresh;
      clearTimer();
      timer = schedule(() => {
        timer = null;
        flush();
      }, delayMs);
      return true;
    },

    cancelPending,
  };
}

export function createFocusedLatestRequestGate() {
  let focused = false;
  let latestRequestId = 0;

  return {
    setFocused(nextFocused: boolean) {
      if (focused === nextFocused) return;
      focused = nextFocused;
      latestRequestId += 1;
    },

    async run<T>(
      request: () => Promise<T>,
      onStart: () => void,
      onComplete: (result: FocusedRequestResult<T>) => void,
    ): Promise<boolean> {
      if (!focused) return false;

      const requestId = ++latestRequestId;
      onStart();

      let result: FocusedRequestResult<T>;
      try {
        result = { ok: true, value: await request() };
      } catch (error) {
        result = { ok: false, error };
      }

      if (!focused || requestId !== latestRequestId) return false;
      onComplete(result);
      return true;
    },
  };
}
