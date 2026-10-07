export type FocusedRequestResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

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
