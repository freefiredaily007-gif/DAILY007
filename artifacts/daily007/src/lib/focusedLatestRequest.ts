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
) {
  const schedule = scheduler.setTimeout ??
    ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const cancel = scheduler.clearTimeout ??
    ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let focused = false;
  let timer: unknown | null = null;
  let pendingRefresh: (() => void | Promise<void>) | null = null;
  let refreshInFlight = false;
  let flightRevision = 0;

  const clearTimer = () => {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  };
  const cancelPending = () => {
    clearTimer();
    pendingRefresh = null;
  };

  const flush = async () => {
    if (!focused || refreshInFlight || !pendingRefresh) return;

    const refresh = pendingRefresh;
    pendingRefresh = null;
    refreshInFlight = true;
    const currentFlightRevision = ++flightRevision;
    try {
      await refresh();
    } finally {
      if (currentFlightRevision === flightRevision) {
        refreshInFlight = false;
        if (focused && pendingRefresh && timer === null) void flush();
      }
    }
  };

  return {
    setFocused(nextFocused: boolean) {
      if (focused === nextFocused) return;
      focused = nextFocused;
      if (!focused) {
        cancelPending();
        flightRevision += 1;
        refreshInFlight = false;
      }
    },

    request(refresh: () => void | Promise<void>): boolean {
      if (!focused) return false;
      pendingRefresh = refresh;
      clearTimer();
      timer = schedule(() => {
        timer = null;
        void flush();
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
