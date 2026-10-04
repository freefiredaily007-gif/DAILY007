import assert from "node:assert/strict";
import test from "node:test";
import {
  LEADERBOARD_REFRESH_POLICY,
  refetchLeaderboardOnFocus,
} from "../src/lib/leaderboardRefreshPolicy.ts";

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("player leaderboard polls, refetches on focus, and reloads after reopening", async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const documentStub = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    document: documentStub,
  };
  globalThis.document = documentStub;

  let client;
  let focusManager;
  let stopPolling = () => {};
  let stopReopened = () => {};
  try {
    const queryLibrary = await import("@tanstack/react-query");
    const { QueryClient, QueryObserver } = queryLibrary;
    focusManager = queryLibrary.focusManager;
    focusManager.setFocused(true);

    assert.equal(LEADERBOARD_REFRESH_POLICY.refetchInterval, 30_000);
    assert.equal(LEADERBOARD_REFRESH_POLICY.refetchOnMount, "always");

    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let prizes = {
      weekly: [{ rank: 1, coins: 10 }, { rank: 2, coins: 20 }, { rank: 3, coins: 30 }],
      monthly: [{ rank: 1, coins: 40 }, { rank: 2, coins: 50 }, { rank: 3, coins: 60 }],
    };
    let reads = 0;
    const queryFn = async () => {
      reads += 1;
      return structuredClone(prizes);
    };
    const baseOptions = {
      queryKey: ["leaderboard-refresh-regression"],
      queryFn,
      staleTime: 60_000,
      ...LEADERBOARD_REFRESH_POLICY,
    };

    // Use a short interval to exercise TanStack Query's real polling behavior
    // quickly; the production interval is asserted above and remains 30 seconds.
    const pollingObserver = new QueryObserver(client, {
      ...baseOptions,
      refetchInterval: 10,
    });
    stopPolling = pollingObserver.subscribe(() => {});
    await waitFor(
      () => reads >= 1 && pollingObserver.getCurrentResult().isSuccess,
      "The initial player leaderboard request did not complete.",
    );
    assert.deepEqual(pollingObserver.getCurrentResult().data, prizes);

    prizes = {
      weekly: [{ rank: 1, coins: 111 }, { rank: 2, coins: 222 }, { rank: 3, coins: 333 }],
      monthly: [{ rank: 1, coins: 444 }, { rank: 2, coins: 555 }, { rank: 3, coins: 666 }],
    };
    await waitFor(
      () => reads >= 2 && pollingObserver.getCurrentResult().data?.weekly[0]?.coins === 111,
      "The active player view did not receive updated prizes on its polling interval.",
    );
    stopPolling();

    const readsBeforeReopen = reads;
    prizes = {
      weekly: [{ rank: 1, coins: 121 }, { rank: 2, coins: 232 }, { rank: 3, coins: 343 }],
      monthly: [{ rank: 1, coins: 454 }, { rank: 2, coins: 565 }, { rank: 3, coins: 676 }],
    };
    const reopenedObserver = new QueryObserver(client, baseOptions);
    stopReopened = reopenedObserver.subscribe(() => {});
    await waitFor(
      () => reads > readsBeforeReopen &&
        reopenedObserver.getCurrentResult().data?.monthly[0]?.coins === 454,
      "Reopening the player view did not request the latest prize schedules.",
    );

    const readsBeforeFocus = reads;
    prizes = {
      weekly: [{ rank: 1, coins: 131 }, { rank: 2, coins: 242 }, { rank: 3, coins: 353 }],
      monthly: [{ rank: 1, coins: 464 }, { rank: 2, coins: 575 }, { rank: 3, coins: 686 }],
    };
    refetchLeaderboardOnFocus(() => reopenedObserver.refetch());
    await waitFor(
      () => reads > readsBeforeFocus &&
        reopenedObserver.getCurrentResult().data?.weekly[0]?.coins === 131,
      "Returning focus to the player view did not request the latest prize schedules.",
    );
  } finally {
    stopPolling();
    stopReopened();
    client?.clear();
    focusManager?.setFocused(undefined);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});