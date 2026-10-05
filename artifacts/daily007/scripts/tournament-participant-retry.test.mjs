import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailSource = readFileSync(
  new URL("../src/screens/TDetail.tsx", import.meta.url),
  "utf8",
);

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("the participant error state exposes an accessible retry that reflects refetch progress", () => {
  const errorBranch = detailSource
    .split(") : participantsQuery.isError || (retryingParticipants && participantsQuery.isFetching) ? (")[1]
    ?.split(") : participants.length === 0 ? (")[0];

  assert.ok(errorBranch, "The participant error state should remain distinct from the empty state.");
  assert.match(errorBranch, /Participant list couldn’t be loaded\./);
  assert.match(
    detailSource,
    /participantsQuery\.isError \|\| \(retryingParticipants && participantsQuery\.isFetching\) \?/,
  );
  assert.match(errorBranch, /<Btn\b/);
  assert.match(errorBranch, /title="RETRY PARTICIPANTS"/);
  assert.match(errorBranch, /onPress=\{retryParticipants\}/);
  assert.match(errorBranch, /loading=\{participantsQuery\.isFetching\}/);
  assert.match(errorBranch, /accessibilityState=\{\{ busy: participantsQuery\.isFetching \}\}/);
  assert.match(errorBranch, /testID="participants-retry"/);
  assert.match(detailSource, /await participantsQuery\.refetch\(\)/);
});

test("a failed participant request can be retried and replaced by the current list", async () => {
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
  let resolveRetry;
  let retryRequest;
  try {
    const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const currentParticipants = {
      participants: [{ players: ["Current Player"], status: "approved" }],
    };
    let requestCount = 0;
    const observer = new QueryObserver(client, {
      queryKey: ["tournament-participant-retry-regression"],
      queryFn: async () => {
        requestCount += 1;
        if (requestCount === 1) throw new Error("Temporary participant outage");
        await new Promise((resolve) => { resolveRetry = resolve; });
        return currentParticipants;
      },
      retry: false,
      enabled: false,
    });
    unsubscribe = observer.subscribe(() => {});

    const failedRequest = await observer.refetch();
    assert.equal(failedRequest.isError, true);
    assert.equal(observer.getCurrentResult().isFetching, false);

    retryRequest = observer.refetch();
    await waitFor(
      () => observer.getCurrentResult().isFetching
        && requestCount === 2
        && typeof resolveRetry === "function",
      "The participant query did not start the retry request.",
    );
    assert.equal(observer.getCurrentResult().isLoading, true);
    assert.equal(requestCount, 2);

    resolveRetry();
    const recoveredRequest = await retryRequest;
    assert.equal(recoveredRequest.isSuccess, true);
    assert.deepEqual(recoveredRequest.data, currentParticipants);
    assert.equal(observer.getCurrentResult().isError, false);
  } finally {
    resolveRetry?.();
    await retryRequest?.catch(() => {});
    unsubscribe();
    client?.clear();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
