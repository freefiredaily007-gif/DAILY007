import assert from "node:assert/strict";
import test from "node:test";
import { resolveTournamentWinnerState } from "../src/lib/tournament-winner-details.ts";

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