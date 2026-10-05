import assert from "node:assert/strict";
import test from "node:test";
import {
  getTournamentResultsRefreshInterval,
  resolveTournamentWinnerState,
  TOURNAMENT_RESULTS_REFRESH_INTERVAL_MS,
} from "../src/lib/tournament-winner-details.ts";

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a completed result set without rank one has a distinct no-winner state", () => {
  assert.deepEqual(
    resolveTournamentWinnerState(false, false, [
      { rank: 2, gameName: "Second Place", prizeCoins: 50 },
      { rank: 3, gameName: "Third Place", prizeCoins: 25 },
    ]),
    { kind: "no-winner" },
  );
});

test("a failed refresh hides stale winner details and recovery shows the current award", async () => {
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
  let unsubscribe = () => {};
  try {
    const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["tournament-winner-details-regression"];
    const staleResults = {
      entries: [{ rank: 1, gameName: "Stale Champion", prizeCoins: 75 }],
    };
    const currentResults = {
      entries: [{ rank: 1, gameName: "Current Champion", prizeCoins: 125 }],
    };
    client.setQueryData(queryKey, staleResults);

    let failRequest = true;
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: async () => {
        if (failRequest) throw new Error("Temporary results outage");
        return currentResults;
      },
      retry: false,
      staleTime: Infinity,
      refetchOnMount: false,
    });
    unsubscribe = observer.subscribe(() => {});

    const failedRequest = await observer.refetch();
    assert.equal(failedRequest.isError, true);
    assert.deepEqual(failedRequest.data, staleResults);
    assert.deepEqual(
      resolveTournamentWinnerState(
        failedRequest.isLoading,
        failedRequest.isError,
        failedRequest.data?.entries,
      ),
      { kind: "error" },
    );

    failRequest = false;
    const recoveredRequest = await observer.refetch();
    assert.equal(recoveredRequest.isSuccess, true);
    assert.deepEqual(recoveredRequest.data, currentResults);
    assert.deepEqual(
      resolveTournamentWinnerState(
        recoveredRequest.isLoading,
        recoveredRequest.isError,
        recoveredRequest.data?.entries,
      ),
      { kind: "winner", entry: currentResults.entries[0] },
    );
  } finally {
    unsubscribe();
    client?.clear();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("completed results poll only while focused and stop without overlapping requests", async () => {
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
  let unsubscribe = () => {};
  let focusManager;
  try {
    const queryLibrary = await import("@tanstack/react-query");
    const { QueryClient, QueryObserver } = queryLibrary;
    focusManager = queryLibrary.focusManager;
    focusManager.setFocused(true);

    assert.equal(TOURNAMENT_RESULTS_REFRESH_INTERVAL_MS, 30_000);
    assert.equal(getTournamentResultsRefreshInterval(false, true), false);
    assert.equal(getTournamentResultsRefreshInterval(true, false), false);
    assert.equal(
      getTournamentResultsRefreshInterval(true, true),
      TOURNAMENT_RESULTS_REFRESH_INTERVAL_MS,
    );

    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["tournament-results-active-screen"];
    const oldResults = {
      entries: [{ rank: 1, gameName: "Old Winner", prizeCoins: 75 }],
    };
    const currentResults = {
      entries: [{ rank: 1, gameName: "Corrected Winner", prizeCoins: 125 }],
    };
    client.setQueryData(queryKey, oldResults);
    let focused = false;
    let reads = 0;
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const queryFn = async () => {
      reads += 1;
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      try {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return currentResults;
      } finally {
        activeRequests -= 1;
      }
    };
    const options = () => ({
      queryKey,
      queryFn,
      staleTime: Infinity,
      refetchOnMount: false,
      refetchInterval: getTournamentResultsRefreshInterval(true, focused)
        ? 10
        : false,
    });
    const observer = new QueryObserver(client, options());
    unsubscribe = observer.subscribe(() => {});

    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(reads, 0, "results should not poll while the detail screen is blurred");

    focused = true;
    observer.setOptions(options());
    await waitFor(
      () => reads >= 2 && observer.getCurrentResult().data?.entries?.[0]?.gameName === "Corrected Winner",
      "The focused completed-match view did not receive corrected winner details.",
    );
    assert.equal(
      resolveTournamentWinnerState(
        observer.getCurrentResult().isLoading,
        observer.getCurrentResult().isError,
        observer.getCurrentResult().data?.entries,
      ).kind,
      "winner",
    );
    assert.equal(observer.getCurrentResult().data.entries[0].prizeCoins, 125);
    assert.equal(maxActiveRequests, 1, "polling should not start overlapping result requests");

    focused = false;
    observer.setOptions(options());
    const readsWhenBlurred = reads;
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(reads, readsWhenBlurred, "results polling should stop when the detail screen blurs");
  } finally {
    unsubscribe();
    client?.clear();
    focusManager?.setFocused(undefined);
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});