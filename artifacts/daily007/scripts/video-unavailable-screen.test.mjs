import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import { getCreditedVideoWatchSeconds } from "../src/lib/video-watch-progress.ts";
import {
  getVideoCatalogRefreshInterval,
  VIDEO_CATALOG_REFRESH_INTERVAL_MS,
} from "../src/lib/videoCatalogRefresh.ts";

const videoSource = readFileSync(
  new URL("../src/screens/Video.tsx", import.meta.url),
  "utf8",
);
const videoSourceFile = ts.createSourceFile(
  "Video.tsx",
  videoSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const apiSource = readFileSync(
  new URL("../src/lib/api.ts", import.meta.url),
  "utf8",
);
const apiSourceFile = ts.createSourceFile(
  "api.ts",
  apiSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);

function findVariableDeclaration(sourceFile, variableName) {
  let declaration = null;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(declaration, `Expected a ${variableName} declaration in ${sourceFile.fileName}.`);
  return declaration;
}

function loadScreenCallback(callbackName, scope) {
  const declaration = findVariableDeclaration(videoSourceFile, callbackName);
  assert.ok(
    declaration.initializer && ts.isCallExpression(declaration.initializer),
    `${callbackName} should be wrapped in useCallback.`,
  );
  assert.equal(declaration.initializer.expression.getText(videoSourceFile), "useCallback");
  const callback = declaration.initializer.arguments[0];
  assert.ok(ts.isArrowFunction(callback), `${callbackName} should use an arrow callback.`);

  const javascript = ts.transpileModule(
    `const __callback = (${callback.getText(videoSourceFile)});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __callback;`,
  )(...Object.values(scope));
}

function findFunctionDeclaration(sourceFile, functionName) {
  let declaration = null;

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node)
      && node.name?.text === functionName
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(declaration, `Expected a ${functionName} helper in ${sourceFile.fileName}.`);
  return declaration;
}

function loadApiErrorHelper() {
  const declaration = findFunctionDeclaration(apiSourceFile, "errMessage");
  const source = declaration.getText(apiSourceFile).replace(/^export\s+/, "");
  const javascript = ts.transpileModule(
    `const __helper = (${source});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  assert.match(apiSource, /export const apiError = errMessage;/);
  return new Function(`${javascript}\nreturn __helper;`)();
}

function findJsxConditional(conditionText) {
  let conditional = null;

  function visit(node) {
    if (
      ts.isJsxExpression(node)
      && node.expression
      && ts.isConditionalExpression(node.expression)
      && node.expression.condition.getText(videoSourceFile) === conditionText
    ) {
      conditional = node.expression;
    }
    ts.forEachChild(node, visit);
  }

  visit(videoSourceFile);
  assert.ok(conditional, `Expected a JSX conditional for ${conditionText}.`);
  return conditional;
}

function evaluateJsxConditional(conditional, scope) {
  const javascript = ts.transpileModule(
    `const __fixtureElement = (${conditional.getText(videoSourceFile)});`,
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __fixtureElement;`,
  )(...Object.values(scope));
}

function createTestView({ children, testID }) {
  return React.createElement(
    "div",
    testID ? { "data-testid": testID } : undefined,
    children,
  );
}

function createTestText({ children }) {
  return React.createElement("span", null, children);
}

function renderError(rewardError) {
  const element = evaluateJsxConditional(findJsxConditional("!!rewardError"), {
    React,
    rewardError,
    sessionStartFailedRef: { current: false },
    View: createTestView,
    Text: createTestText,
    Feather: () => null,
    styles: { errorCard: {}, errorText: {} },
    colors: { destructive: "#ff0000" },
  });

  return renderToStaticMarkup(element);
}

function renderSessionStartRetry(sessionStartRetryAvailable, sessionStartRetryPending) {
  const condition = findJsxConditional(
    "sessionStartRetryAvailable || sessionStartRetryPending",
  );
  const element = evaluateJsxConditional(condition, {
    React,
    sessionStartRetryAvailable,
    sessionStartRetryPending,
    Pressable: ({
      accessibilityLabel,
      accessibilityHint,
      accessibilityState,
      children,
      disabled,
      testID,
    }) => React.createElement(
      "button",
      {
        "aria-label": accessibilityLabel,
        "aria-description": accessibilityHint,
        "aria-busy": accessibilityState.busy,
        "data-testid": testID,
        disabled,
      },
      children,
    ),
    Text: createTestText,
    Feather: () => null,
    styles: { retryButton: {}, externalButtonText: {} },
    colors: { primary: "#0000ff" },
    retryFailedSessionStart() {},
  });

  return renderToStaticMarkup(element);
}

function waitFor(predicate, message) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 1_000;
    const poll = () => {
      if (predicate()) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error(message));
      } else {
        setTimeout(poll, 5);
      }
    };
    poll();
  });
}

test("a failed start can retry the same attempt without counting the failed wait or changing replay identity", async () => {
  const unavailableMessage = "This video is unavailable.";
  const apiError = loadApiErrorHelper();
  const unavailableResponse = {
    response: {
      data: { error: unavailableMessage },
    },
    message: "Request failed with status code 404",
  };
  const currentSessionRef = { current: null };
  const startingSessionRef = { current: false };
  const sessionStartFailedRef = { current: false };
  const playbackCycleRef = { current: 1 };
  const appLifecycleCycleRef = { current: 0 };
  const appIsActiveRef = { current: true };
  const progressPercentRef = { current: 0 };
  const watchedSecondBucketsRef = { current: new Set() };
  const startAttemptIdRef = { current: null };
  const startRequestRef = { current: null };
  const latestPlaybackTimeRef = { current: null };
  const lastSampleRef = { current: null };
  const progressWrites = [];
  const rewardErrors = [];
  const retrySessionWrites = [];
  const startRequests = [];
  const sessionStartRetryAvailable = { current: false };
  const sessionStartRetryPending = { current: false };
  let generatedAttempt = 0;
  let creditedSecondsCalls = 0;
  let rejectInitialStart;
  const setSessionStartRetryAvailable = (value) => {
    sessionStartRetryAvailable.current = value;
  };
  const setSessionStartRetryPending = (value) => {
    sessionStartRetryPending.current = value;
  };
  const startVideoWatchSession = loadScreenCallback("startVideoWatchSession", {
    startingSessionRef,
    sessionStartFailedRef,
    setRewardError: (value) => rewardErrors.push(value),
    appLifecycleCycleRef,
    startVideoWatch: ({ data }) => {
      startRequests.push(data);
      if (startRequests.length === 1) {
        return new Promise((_, reject) => {
          rejectInitialStart = reject;
        });
      }
      return Promise.resolve({ sessionId: "session-after-retry" });
    },
    playbackCycleRef,
    currentSessionRef,
    setSessionStartRetryAvailable,
    setSessionStartRetryPending,
    appIsActiveRef,
    latestPlaybackTimeRef,
    lastSampleRef,
    apiError,
  });
  const finishCurrentPlayback = loadScreenCallback("finishCurrentPlayback", {
    currentSessionRef,
    startAttemptIdRef,
    startRequestRef,
    latestPlaybackTimeRef,
    playbackCycleRef,
    startingSessionRef,
    sessionStartFailedRef,
    setSessionStartRetryAvailable,
    setSessionStartRetryPending,
    lastSampleRef,
    progressPercentRef,
    setRewardError: (value) => rewardErrors.push(value),
    WATCH_MARK_PERCENT: 75,
    claimViewReward() {},
  });
  const handlePlayerMessage = loadScreenCallback("handlePlayerMessage", {
    showPlayer: true,
    selectedVideo: { id: "test-video" },
    ENDED_STATE: 0,
    PLAYING_STATE: 1,
    finishCurrentPlayback,
    setPlayerReady() {},
    setPlayerFailed() {},
    appIsActiveRef,
    currentSessionRef,
    lastSampleRef,
    latestPlaybackTimeRef,
    startingSessionRef,
    sessionStartFailedRef,
    playbackCycleRef,
    watchedSecondBucketsRef,
    progressPercentRef,
    setProgressPercent: (value) => progressWrites.push(value),
    setRewardMessage() {},
    setRewardError: (value) => rewardErrors.push(value),
    appLifecycleCycleRef,
    startAttemptIdRef,
    startRequestRef,
    createVideoWatchAttemptId: () => `attempt-${++generatedAttempt}`,
    startVideoWatchSession,
    getCreditedVideoWatchSeconds: (...args) => {
      creditedSecondsCalls += 1;
      return getCreditedVideoWatchSeconds(...args);
    },
    setRetrySession: (value) => retrySessionWrites.push(value),
    setSessionStartRetryAvailable,
    setSessionStartRetryPending,
  });

  handlePlayerMessage({
    type: "progress",
    currentTime: 12,
    duration: 60,
    playing: true,
  });
  handlePlayerMessage({
    type: "progress",
    currentTime: 13,
    duration: 60,
    playing: true,
  });
  handlePlayerMessage({
    type: "progress",
    currentTime: 14,
    duration: 60,
    playing: true,
  });
  assert.equal(startingSessionRef.current, true);
  assert.deepEqual(progressWrites, [0], "Playback while the start request is pending must not be credited.");
  rejectInitialStart(unavailableResponse);
  await waitFor(
    () => rewardErrors.at(-1) === unavailableMessage,
    "The API start failure should reach the screen error state.",
  );

  assert.equal(rewardErrors.at(-1), unavailableMessage);
  assert.equal(sessionStartFailedRef.current, true);
  assert.equal(startingSessionRef.current, false);
  assert.equal(currentSessionRef.current, null);
  assert.equal(progressPercentRef.current, 0);
  assert.deepEqual(startRequests, [{
    videoId: "test-video",
    durationSeconds: 60,
    attemptId: "attempt-1",
  }]);
  assert.equal(sessionStartRetryAvailable.current, true);

  const errorMarkup = renderError(rewardErrors.at(-1));
  assert.match(errorMarkup, /data-testid="video-watch-error"/);
  assert.match(errorMarkup, /This video is unavailable\./);

  const retryMarkup = renderSessionStartRetry(
    sessionStartRetryAvailable.current,
    sessionStartRetryPending.current,
  );
  assert.match(retryMarkup, /data-testid="video-retry-session-start"/);
  assert.match(retryMarkup, /aria-label="Retry starting this video reward session"/);
  assert.match(retryMarkup, /aria-description="Retries the session for this playback without restarting the video\."/);

  handlePlayerMessage({
    type: "progress",
    currentTime: 15,
    duration: 60,
    playing: true,
  });

  assert.deepEqual(progressWrites, [0], "Progress should stay at zero after the rejected start.");
  assert.equal(progressPercentRef.current, 0);
  assert.equal(watchedSecondBucketsRef.current.size, 0);
  assert.equal(creditedSecondsCalls, 0, "Rejected playback samples must not be credited.");
  assert.equal(startRequests.length, 1, "The failed playback should not automatically start again.");
  assert.deepEqual(retrySessionWrites, [], "A start failure must not create a reward-claim retry.");
  assert.ok(videoSource.includes(
    "const [retrySession, setRetrySession] = useState<{ sessionId: string; percent: number } | null>(null);",
  ));

  const retryFailedSessionStart = loadScreenCallback("retryFailedSessionStart", {
    showPlayer: true,
    selectedVideo: { id: "test-video" },
    sessionStartRetryAvailable: true,
    startingSessionRef,
    currentSessionRef,
    startRequestRef,
    setSessionStartRetryPending,
    startVideoWatchSession,
    playbackCycleRef,
  });
  retryFailedSessionStart();
  assert.equal(sessionStartRetryPending.current, true);
  await waitFor(
    () => currentSessionRef.current === "session-after-retry",
    "The explicit retry should establish a session.",
  );
  assert.deepEqual(startRequests, [
    {
      videoId: "test-video",
      durationSeconds: 60,
      attemptId: "attempt-1",
    },
    {
      videoId: "test-video",
      durationSeconds: 60,
      attemptId: "attempt-1",
    },
  ], "Retry must preserve the original attempt identity and video details.");
  assert.equal(sessionStartRetryAvailable.current, false);
  assert.equal(sessionStartRetryPending.current, false);
  assert.deepEqual(
    getCreditedVideoWatchSeconds(
      lastSampleRef.current,
      lastSampleRef.current.currentTime + 1,
      lastSampleRef.current.receivedAt + 1_000,
      60,
    ),
    [15],
    "The successful retry baseline must exclude playback time spent waiting for the failed request.",
  );

  handlePlayerMessage({ type: "state", state: 0 });
  handlePlayerMessage({
    type: "progress",
    currentTime: 14,
    duration: 60,
    playing: true,
  });
  await waitFor(
    () => currentSessionRef.current === "session-after-retry",
    "The deliberate replay should start a fresh session.",
  );
  assert.equal(startRequests.length, 3);
  assert.equal(startRequests[2].videoId, "test-video");
  assert.equal(startRequests[2].attemptId, "attempt-2");
  assert.notEqual(startRequests[2].attemptId, startRequests[1].attemptId);
});

test("the visible catalog removes a video disabled while it stays open", async () => {
  assert.equal(VIDEO_CATALOG_REFRESH_INTERVAL_MS, 60_000);
  assert.equal(
    getVideoCatalogRefreshInterval({
      isFocused: true,
      isAppActive: true,
      isPlayerOpen: false,
    }),
    VIDEO_CATALOG_REFRESH_INTERVAL_MS,
  );
  assert.equal(
    getVideoCatalogRefreshInterval({
      isFocused: false,
      isAppActive: true,
      isPlayerOpen: false,
    }),
    false,
  );
  assert.equal(
    getVideoCatalogRefreshInterval({
      isFocused: true,
      isAppActive: false,
      isPlayerOpen: false,
    }),
    false,
  );
  assert.equal(
    getVideoCatalogRefreshInterval({
      isFocused: true,
      isAppActive: true,
      isPlayerOpen: true,
    }),
    false,
  );
  assert.match(
    videoSource,
    /enabled: isFocused && isAppActive && !showPlayer,[\s\S]*?refetchInterval: getVideoCatalogRefreshInterval\(\{[\s\S]*?isPlayerOpen: showPlayer/,
  );
  assert.match(videoSource, /refetchIntervalInBackground: false/);
  assert.match(videoSource, /void videosQuery\.refetch\(\)/);
  assert.match(videoSource, /const videos: VideoItem\[\] = \(videosQuery\.data\?\.videos \?\? \[\]\)/);
  assert.match(videoSource, /filteredVideos\.map\(\(video\) =>/);
  assert.match(videoSource, /testID="video-catalog-back"[^>]*onPress=\{closePlayer\}/);

  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  };
  const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  let activeVideos = [{ id: "disabled-video", title: "Video before admin disables it" }];
  let requestCount = 0;
  const queryOptions = {
    queryKey: ["video-catalog-refresh-regression"],
    queryFn: async () => {
      requestCount += 1;
      return activeVideos;
    },
    refetchInterval: getVideoCatalogRefreshInterval({
      isFocused: true,
      isAppActive: true,
      isPlayerOpen: false,
    }, 5),
    refetchIntervalInBackground: false,
  };
  const observer = new QueryObserver(queryClient, queryOptions);
  const unsubscribe = observer.subscribe(() => {});

  await waitFor(
    () => observer.getCurrentResult().data?.[0]?.id === "disabled-video",
    "The catalog query should load the initially active video.",
  );
  activeVideos = [];
  await waitFor(
    () => observer.getCurrentResult().data?.length === 0,
    "A scheduled catalog refresh should remove the video disabled by the admin.",
  );
  assert.ok(requestCount >= 2);

  observer.setOptions({
    ...queryOptions,
    refetchInterval: getVideoCatalogRefreshInterval({
      isFocused: true,
      isAppActive: true,
      isPlayerOpen: true,
    }, 5),
  });
  const requestsWhenPlayerOpened = requestCount;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(requestCount, requestsWhenPlayerOpened, "Opening the player should stop catalog polling.");

  unsubscribe();
  queryClient.clear();
});
