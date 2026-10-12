import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailSource = readFileSync(
  new URL("../src/screens/TDetail.tsx", import.meta.url),
  "utf8",
);
const typographySource = readFileSync(
  new URL("../src/components/typography.tsx", import.meta.url),
  "utf8",
);
const uiSource = readFileSync(
  new URL("../src/components/ui.tsx", import.meta.url),
  "utf8",
);
const participantAvailabilityExpression = detailSource.match(
  /const participantListUnavailable = ([^;]+);/,
)?.[1];
const participantCountExpression = detailSource.match(
  /const participantCountLabel = ([^;]+);/,
)?.[1];
const initialParticipantLoadingExpression = detailSource.match(
  /\{(participantsQuery\.isLoading && !participantsQuery\.data && !retryingParticipants) \?/,
)?.[1];
const evaluateInitialParticipantLoading = initialParticipantLoadingExpression
  ? new Function(
    "participantsQuery",
    "retryingParticipants",
    `return (${initialParticipantLoadingExpression});`,
  )
  : null;
const evaluateParticipantAvailability = participantAvailabilityExpression
  ? new Function(
    "participantsQuery",
    "retryingParticipants",
    `return (${participantAvailabilityExpression});`,
  )
  : null;
const evaluateParticipantCount = participantCountExpression
  ? new Function(
    "participantListUnavailable",
    "participants",
    `return (${participantCountExpression});`,
  )
  : null;

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("TalkBack gets retry guidance and outcome announcements without disabling the focused control", () => {
  const initialLoadingBranch = detailSource
    .split("participantsQuery.isLoading && !participantsQuery.data && !retryingParticipants ? (")[1]
    ?.split(") : participantListUnavailable ? (")[0];
  const errorBranch = detailSource
    .split(") : participantListUnavailable ? (")[1]
    ?.split(") : participants.length === 0 ? (")[0];
  const retryStatusOffset = detailSource.indexOf('testID="participants-retry-status"');
  const participantStateOffset = detailSource.indexOf("participantsQuery.isLoading && !participantsQuery.data");

  assert.ok(initialLoadingBranch, "The initial participant loading state must remain distinct from retries and refreshes.");
  assert.ok(evaluateInitialParticipantLoading, "The initial loading condition should be testable.");
  assert.equal(
    evaluateInitialParticipantLoading({ isLoading: true, data: undefined }, false),
    true,
    "A first load should expose its progress announcement.",
  );
  assert.equal(
    evaluateInitialParticipantLoading({ isLoading: false, isFetching: true, data: { participants: [] } }, false),
    false,
    "A background refresh with cached participants should not repeat the progress announcement.",
  );
  assert.equal(
    evaluateInitialParticipantLoading({ isLoading: true, data: undefined }, true),
    false,
    "A manual retry should not repeat the initial-load announcement.",
  );
  assert.match(initialLoadingBranch, /<ActivityIndicator accessible=\{false\}/);
  assert.match(
    initialLoadingBranch,
    /<Text\s+accessible\s+accessibilityRole="text"\s+accessibilityLabel="Loading participants\."\s+accessibilityLiveRegion="polite"\s+testID="participants-initial-loading-status"/,
  );
  assert.match(initialLoadingBranch, /Loading participants…/);
  assert.doesNotMatch(initialLoadingBranch, /numberOfLines=|ellipsizeMode=|overflow:\s*['"]hidden/);
  assert.ok(errorBranch, "The participant error state should remain distinct from the empty state.");
  assert.match(errorBranch, /Participant list couldn’t be loaded\./);
  assert.match(
    detailSource,
    /const participantListUnavailable = participantsQuery\.isError \|\| \(retryingParticipants && participantsQuery\.isFetching\);/,
  );
  assert.match(errorBranch, /<Btn\b/);
  assert.match(errorBranch, /title="RETRY PARTICIPANTS"/);
  assert.match(errorBranch, /onPress=\{retryParticipants\}/);
  assert.match(errorBranch, /accessibilityRole="text"/);
  assert.match(errorBranch, /accessibilityLiveRegion="polite"/);
  assert.match(errorBranch, /testID="participants-error-guidance"/);
  assert.match(errorBranch, /accessibilityLabel="Retry participant list"/);
  assert.match(errorBranch, /loading=\{participantsQuery\.isFetching\}/);
  assert.match(errorBranch, /preserveAccessibilityFocusWhileLoading/);
  assert.match(errorBranch, /accessibilityState=\{\{ busy: participantsQuery\.isFetching \}\}/);
  assert.match(errorBranch, /testID="participants-retry"/);
  assert.match(detailSource, /announceParticipantsRetry\('Retrying participant list\.'/);
  assert.match(detailSource, /'Participant list updated\.'/);
  assert.match(detailSource, /Retry failed\. The participant list is still unavailable\. You can retry again\./);
  assert.match(detailSource, /result\.isSuccess/);
  assert.match(
    detailSource,
    /<Text\s+accessible\s+accessibilityRole="text"\s+accessibilityLiveRegion="polite"\s+testID="participants-retry-status"/,
  );
  assert.ok(
    retryStatusOffset >= 0 && retryStatusOffset < participantStateOffset,
    "Retry status must remain mounted outside the error branch so recovery is announced after it closes.",
  );
  assert.match(detailSource, /if \(retryParticipantsInFlight\.current \|\| participantsQuery\.isFetching\) return;/);
  assert.match(detailSource, /await participantsQuery\.refetch\(\)/);
  assert.match(uiSource, /preserveAccessibilityFocusWhileLoading = false/);
  assert.match(
    uiSource,
    /disabled=\{disabled \|\| \(loading && !preserveAccessibilityFocusWhileLoading\)\}/,
  );
  assert.match(uiSource, /accessibilityLabel=\{accessibilityLabel \|\| title\}/);
  assert.match(uiSource, /accessibilityState=\{accessibilityState\}/);
});

test("VoiceOver gets explicit participant retry guidance and start, success, and failure announcements", () => {
  const errorBranch = detailSource
    .split(") : participantListUnavailable ? (")[1]
    ?.split(") : participants.length === 0 ? (")[0];

  assert.match(detailSource, /import \{[^}]*AccessibilityInfo[^}]*Platform[^}]*\} from 'react-native';/);
  assert.match(
    detailSource,
    /const announceParticipantsRetry = \(message: string\) => \{\s*setParticipantsRetryAnnouncement\(message\);\s*if \(Platform\.OS === 'ios'\) AccessibilityInfo\.announceForAccessibility\(message\);\s*\};/,
  );
  assert.match(detailSource, /announceParticipantsRetry\('Retrying participant list\.'/);
  assert.match(detailSource, /announceParticipantsRetry\(\s*result\.isSuccess\s*\?/);
  assert.match(detailSource, /announceParticipantsRetry\(\s*'Retry failed\. The participant list is still unavailable\. You can retry again\.'/);
  assert.match(errorBranch ?? "", /accessibilityLabel="Participant list couldn’t be loaded\. Try again here or pull down to retry\."/);
  assert.match(errorBranch ?? "", /accessibilityLabel="Retry participant list"/);
  assert.match(errorBranch ?? "", /accessibilityHint="Loads the latest list of joined players and teams\."/);
  assert.match(errorBranch ?? "", /preserveAccessibilityFocusWhileLoading/);
});

test("participant retry guidance and control wrap at enlarged text without clipping", () => {
  const errorBranch = detailSource
    .split(") : participantListUnavailable ? (")[1]
    ?.split(") : participants.length === 0 ? (")[0];
  const retryButton = errorBranch?.match(/<Btn\b[\s\S]*?\/>/)?.[0];
  const retryTextStyle = uiSource.match(/btnText: \{[^}]+\}/)?.[0];
  const retryPressableStyle = uiSource.match(/btn: \{[^}]+\}/)?.[0];
  const guidanceStyle = detailSource.match(/participantsHint: \{[^}]+\}/)?.[0];

  assert.ok(errorBranch, "The participant error guidance must remain present at 1.5× text size.");
  assert.match(errorBranch, /Participant list couldn’t be loaded\. Try again here or pull down to retry\./);
  assert.doesNotMatch(errorBranch, /numberOfLines=|ellipsizeMode=|overflow:\s*['"]hidden/);
  assert.ok(retryButton, "The retry remains a separate button in the error card.");
  assert.match(retryButton, /title="RETRY PARTICIPANTS"/);
  assert.match(retryButton, /minHeight:\s*48/);
  assert.match(retryButton, /alignSelf:\s*['"]stretch['"]/);
  assert.match(retryButton, /testID="participants-retry"/);
  assert.match(uiSource, /accessibilityRole="button"/);
  assert.match(uiSource, /onPress=\{onPress\}/);
  assert.match(retryPressableStyle ?? "", /paddingVertical:/);
  assert.doesNotMatch(retryPressableStyle ?? "", /\bheight:/);
  assert.match(retryTextStyle ?? "", /fontSize:/);
  assert.doesNotMatch(retryTextStyle ?? "", /numberOfLines|ellipsizeMode/);
  assert.match(guidanceStyle ?? "", /lineHeight:/);
  assert.doesNotMatch(typographySource, /allowFontScaling=\{false\}/);
  assert.match(typographySource, /<NativeText\s+\{\.\.\.props\}/);
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

test("a failed participant refresh exposes retry instead of cached entries, then replaces them", async () => {
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
    const queryKey = ["tournament-participant-cached-retry-regression"];
    const cachedParticipants = {
      participants: [
        { players: ["Cached Player One"], status: "approved" },
        { players: ["Cached Player Two"], status: "approved" },
      ],
    };
    const currentParticipants = {
      participants: [{ players: ["Updated Player"], status: "approved" }],
    };
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKey, cachedParticipants);

    let requestCount = 0;
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn: async () => {
        requestCount += 1;
        if (requestCount === 1) throw new Error("Temporary participant outage");
        return currentParticipants;
      },
      retry: false,
      enabled: false,
    });
    unsubscribe = observer.subscribe(() => {});

    assert.deepEqual(observer.getCurrentResult().data, cachedParticipants);
    const failedRefresh = await observer.refetch();
    assert.equal(failedRefresh.isError, true);
    assert.deepEqual(failedRefresh.data, cachedParticipants);
    assert.equal(observer.getCurrentResult().isError, true);
    assert.ok(evaluateParticipantAvailability, "The screen should expose a testable participant availability expression.");
    assert.ok(evaluateParticipantCount, "The section heading should derive its count label from query availability.");
    assert.equal(
      evaluateParticipantCount(
        evaluateParticipantAvailability(failedRefresh, false),
        failedRefresh.data.participants,
      ),
      "COUNT UNAVAILABLE",
      "A failed refresh must hide the cached participant total.",
    );
    assert.equal(
      evaluateParticipantCount(
        evaluateParticipantAvailability({ isError: false, isFetching: true }, true),
        cachedParticipants.participants,
      ),
      "COUNT UNAVAILABLE",
      "An in-progress retry must not present the cached total as current.",
    );

    const errorBranch = detailSource
      .split(") : participantListUnavailable ? (")[1]
      ?.split(") : participants.length === 0 ? (")[0];
    assert.ok(errorBranch, "A cached-data request error should render the participant retry state.");
    assert.match(errorBranch, /Participant list couldn’t be loaded\./);
    assert.match(errorBranch, /title="RETRY PARTICIPANTS"/);
    assert.match(errorBranch, /onPress=\{retryParticipants\}/);
    assert.match(detailSource, /JOINED (?:TEAMS|PLAYERS) · \$\{participantCountLabel\}/);
    assert.match(detailSource, /participantCountLabel = participantListUnavailable \? 'COUNT UNAVAILABLE' : participants\.length/);
    assert.ok(
      detailSource.indexOf(") : participantListUnavailable ? (")
        < detailSource.indexOf("participants.length === 0 ?"),
      "The error state must take precedence over rendering cached participant entries.",
    );

    const recoveredRefresh = await observer.refetch();
    assert.equal(recoveredRefresh.isSuccess, true);
    assert.deepEqual(recoveredRefresh.data, currentParticipants);
    assert.equal(observer.getCurrentResult().isError, false);
    assert.deepEqual(observer.getCurrentResult().data, currentParticipants);
    assert.equal(
      evaluateParticipantCount(
        evaluateParticipantAvailability(recoveredRefresh, false),
        recoveredRefresh.data.participants,
      ),
      1,
      "A successful retry should restore the count from the latest participant list.",
    );
    assert.equal(requestCount, 2);
  } finally {
    unsubscribe();
    client?.clear();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
