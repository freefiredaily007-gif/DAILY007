export const INITIAL_RETRY_DELAY_MS = 1_000;
export const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RETRY_STEP = 5;

type RetryScheduler = {
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
};

export function isUsableNetworkState(networkState: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}): boolean {
  return networkState.isConnected === true &&
    networkState.isInternetReachable !== false;
}

export function createFocusedRetryController(scheduler: RetryScheduler = {}) {
  const schedule = scheduler.setTimeout ??
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel = scheduler.clearTimeout ??
    ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  let focused = false;
  let networkUsable = false;
  let appActive = true;
  let retryStep = 0;
  let timer: unknown | null = null;

  const cancelPending = () => {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  };

  return {
    setFocused(nextFocused: boolean) {
      if (focused === nextFocused) return;
      focused = nextFocused;
      if (!focused) {
        cancelPending();
        retryStep = 0;
      }
    },

    setNetworkUsable(nextNetworkUsable: boolean) {
      networkUsable = nextNetworkUsable;
      if (!networkUsable) {
        cancelPending();
        retryStep = 0;
      }
    },

    setAppActive(nextAppActive: boolean) {
      appActive = nextAppActive;
      if (!appActive) {
        cancelPending();
        retryStep = 0;
      }
    },

    cancelPending,

    scheduleRetry(onRetry: () => void): number | null {
      cancelPending();
      if (!focused || !appActive || !networkUsable) return null;

      const delayMs = Math.min(
        INITIAL_RETRY_DELAY_MS * 2 ** retryStep,
        MAX_RETRY_DELAY_MS,
      );
      retryStep = Math.min(retryStep + 1, MAX_RETRY_STEP);
      timer = schedule(() => {
        timer = null;
        if (focused && appActive && networkUsable) onRetry();
      }, delayMs);
      return delayMs;
    },

    markSuccess() {
      cancelPending();
      retryStep = 0;
    },
  };
}
