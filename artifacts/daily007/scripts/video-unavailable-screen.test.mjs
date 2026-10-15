import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import { getCreditedVideoWatchSeconds } from "../src/lib/video-watch-progress.ts";
import {
  getVideoCatalogRefreshInterval,
  shouldRefreshVideoCatalogOnFocus,
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
const videoAccessibilityControlsSource = readFileSync(
  new URL("../src/components/VideoAccessibilityControls.tsx", import.meta.url),
  "utf8",
);
const videoAccessibilityControlsSourceFile = ts.createSourceFile(
  "VideoAccessibilityControls.tsx",
  videoAccessibilityControlsSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const nativeTestSource = readFileSync(
  new URL("../src/screens/VideoUnavailableNativeTest.tsx", import.meta.url),
  "utf8",
);
const maestroFlow = readFileSync(
  new URL("../maestro/video-unavailable/unavailable-start.yaml", import.meta.url),
  "utf8",
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

function loadVideoUnavailableErrorAnnouncement() {
  const declaration = findFunctionDeclaration(
    videoAccessibilityControlsSourceFile,
    "VideoUnavailableErrorAnnouncement",
  );
  const source = declaration
    .getText(videoAccessibilityControlsSourceFile)
    .replace(/^export\s+/, "");
  const javascript = ts.transpileModule(
    `const __component = (${source});`,
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  return new Function(
    "React",
    "View",
    "Text",
    "Feather",
    `${javascript}\nreturn __component;`,
  )(React, createTestView, createTestText, () => null);
}

function loadVideoEmbedFailureRecovery(onPressCapture) {
  const declaration = findFunctionDeclaration(
    videoAccessibilityControlsSourceFile,
    "VideoEmbedFailureRecovery",
  );
  const source = declaration
    .getText(videoAccessibilityControlsSourceFile)
    .replace(/^export\s+/, "");
  const javascript = ts.transpileModule(
    `const __component = (${source});`,
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  function createTestPressable({
    children,
    accessibilityHint,
    accessibilityLabel,
    accessibilityRole,
    accessibilityState,
    disabled,
    onPress,
    testID,
  }) {
    onPressCapture.current = onPress;
    return React.createElement(
      "button",
      {
        "aria-description": accessibilityHint,
        "aria-label": accessibilityLabel,
        "aria-busy": accessibilityState?.busy,
        disabled,
        role: accessibilityRole,
        "data-testid": testID,
      },
      children,
    );
  }

  return new Function(
    "React",
    "View",
    "Text",
    "Pressable",
    "Feather",
    "StyleSheet",
    "useColors",
    `${javascript}\nreturn __component;`,
  )(
    React,
    createTestView,
    createTestText,
    createTestPressable,
    () => null,
    { create: (styles) => styles },
    () => ({
      card: "#fff",
      border: "#ddd",
      radius: 8,
      mutedForeground: "#555",
      destructive: "#c00",
      primary: "#06c",
    }),
  );
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

function createTestText({
  children,
  accessibilityLiveRegion,
  accessibilityRole,
  testID,
}) {
  return React.createElement(
    "span",
    {
      ...(accessibilityLiveRegion ? { "aria-live": accessibilityLiveRegion } : {}),
      ...(accessibilityRole ? { role: accessibilityRole } : {}),
      ...(testID ? { "data-testid": testID } : {}),
    },
    children,
  );
}

function renderError(rewardError, announce = true) {
  const element = evaluateJsxConditional(findJsxConditional("!!rewardError"), {
    React,
    rewardError,
    sessionStartFailedRef: { current: announce },
    VideoUnavailableErrorAnnouncement: loadVideoUnavailableErrorAnnouncement(),
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

function renderCoinClaimRetry(retrySession) {
  return createCoinClaimRetry(retrySession, () => {}).markup;
}

function createCoinClaimRetry(retrySession, claimViewReward, rewardPending = false) {
  let onPress = null;
  const element = evaluateJsxConditional(findJsxConditional("retrySession"), {
    React,
    retrySession,
    View: ({ children }) => React.createElement("div", {}, children),
    Pressable: ({ accessibilityLabel, children, onPress: pressHandler, testID }) => {
      onPress = pressHandler;
      return React.createElement(
        "button",
        { "aria-label": accessibilityLabel, "data-testid": testID },
        children,
      );
    },
    Text: createTestText,
    Feather: () => null,
    styles: { retryButton: {}, externalButtonText: {}, errorCard: {} },
    colors: { primary: "#0000ff", accent: "#00aaff", destructive: "#ff0000" },
    rewardPending,
    rewardError: "",
    claimViewReward,
  });

  return { markup: renderToStaticMarkup(element), onPress };
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

test("retrying a failed coin claim resubmits the same video session and playback percentage", async () => {
  const apiError = loadApiErrorHelper();
  const playbackCycleRef = { current: 1 };
  const claimRequests = [];
  let retrySession = null;
  let rewardError = "";
  let rewardMessage = "";
  let rewardPending = false;
  let refreshCalls = 0;
  let persistedRetry = null;
  const claimViewReward = loadScreenCallback("claimViewReward", {
    playbackCycleRef,
    accountId: "player-1",
    captureSessionIdentity: () => ({ accountId: "player-1", token: "test-token", revision: 1 }),
    isSessionIdentityCurrent: () => true,
    savePendingVideoRewardRetry: async (accountId, sessionId, percent) => {
      persistedRetry = { accountId, sessionId, percent };
    },
    clearPendingVideoRewardRetry: async (accountId, expectedSessionId) => {
      if (!expectedSessionId || persistedRetry?.sessionId === expectedSessionId) {
        persistedRetry = null;
      }
    },
    setRewardPending: (value) => { rewardPending = value; },
    setRewardError: (value) => { rewardError = value; },
    completeVideoWatch: ({ data }) => {
      claimRequests.push(data);
      assert.deepEqual(
        persistedRetry,
        {
          accountId: "player-1",
          sessionId: "original-video-session",
          percent: 82.5,
        },
        "The original session retry should be saved before each reward request.",
      );
      if (claimRequests.length === 1) {
        return Promise.reject(new Error("Temporary ledger save failure"));
      }
      return Promise.resolve({ message: "1 coin added to your wallet.", rewarded: true });
    },
    setRewardMessage: (value) => { rewardMessage = value; },
    setRetrySession: (value) => { retrySession = value; },
    refresh: async () => { refreshCalls += 1; },
    apiError,
    VIDEO_UNAVAILABLE_FOR_REWARDS: "This video is unavailable.",
  });

  await claimViewReward("original-video-session", 82.5);
  assert.equal(rewardError, "Temporary ledger save failure");
  assert.deepEqual(retrySession, {
    sessionId: "original-video-session",
    percent: 82.5,
  });
  assert.deepEqual(persistedRetry, {
    accountId: "player-1",
    sessionId: "original-video-session",
    percent: 82.5,
  }, "The same-session retry reference should persist after a failed claim.");
  assert.equal(rewardPending, false);

  const retryControl = createCoinClaimRetry(retrySession, claimViewReward, rewardPending);
  assert.match(retryControl.markup, /data-testid="video-retry-claim"/);
  assert.equal(typeof retryControl.onPress, "function");
  retryControl.onPress();

  await waitFor(
    () => claimRequests.length === 2 && rewardMessage !== "",
    "The retry action should submit the claim again and show its success message.",
  );
  assert.deepEqual(claimRequests, [
    { sessionId: "original-video-session", percentWatched: 82.5 },
    { sessionId: "original-video-session", percentWatched: 82.5 },
  ]);
  assert.equal(rewardMessage, "1 coin added to your wallet.");
  assert.equal(rewardError, "");
  assert.equal(retrySession, null, "A successful claim should clear the retry session.");
  assert.equal(persistedRetry, null, "A successful claim should clear the saved retry reference.");
  assert.equal(rewardPending, false);
  assert.equal(refreshCalls, 1);
  assert.equal(
    renderCoinClaimRetry(retrySession),
    "",
    "The coin-claim retry control should disappear after success.",
  );
});

test("a permanently unavailable video clears its saved retry reference", async () => {
  const playbackCycleRef = { current: 1 };
  let retrySession = { sessionId: "expired-session", percent: 80 };
  let persistedRetry = { sessionId: "expired-session" };
  let rewardError = "";
  let clearCalls = 0;
  const claimViewReward = loadScreenCallback("claimViewReward", {
    playbackCycleRef,
    accountId: "player-1",
    captureSessionIdentity: () => ({ accountId: "player-1", token: "test-token", revision: 1 }),
    isSessionIdentityCurrent: () => true,
    savePendingVideoRewardRetry: async () => {},
    clearPendingVideoRewardRetry: async (_accountId, sessionId) => {
      clearCalls += 1;
      if (persistedRetry?.sessionId === sessionId) persistedRetry = null;
    },
    setRewardPending() {},
    setRewardError: (value) => { rewardError = value; },
    completeVideoWatch: async () => {
      throw new Error("This video is no longer available for rewards.");
    },
    setRewardMessage() {},
    setRetrySession: (value) => { retrySession = value; },
    refresh: async () => {},
    apiError: loadApiErrorHelper(),
    VIDEO_UNAVAILABLE_FOR_REWARDS: "This video is no longer available for rewards.",
  });

  await claimViewReward("expired-session", 80);
  assert.equal(retrySession, null);
  assert.equal(persistedRetry, null);
  assert.equal(clearCalls, 1);
  assert.equal(rewardError, "This video is no longer available for rewards.");
});

test("an embed failure announces once and exposes an actionable YouTube recovery button", () => {
  const onPressCapture = { current: null };
  const EmbedFailureRecovery = loadVideoEmbedFailureRecovery(onPressCapture);
  let activated = false;
  const markup = renderToStaticMarkup(
    React.createElement(EmbedFailureRecovery, {
      busy: false,
      onOpenYouTube: () => { activated = true; },
    }),
  );

  assert.match(markup, /data-testid="video-embed-failure-message"/);
  assert.match(markup, /This video could not be embedded\. Open it on YouTube instead\./);
  assert.match(markup, /role="text"/);
  assert.match(markup, /aria-live="polite"/);
  assert.equal(
    markup.match(/aria-live="polite"/g)?.length ?? 0,
    1,
    "The embed-failure message should have exactly one polite announcement target.",
  );
  assert.match(markup, /<button[^>]*aria-label="Open on YouTube"[^>]*role="button"/);
  assert.match(markup, /aria-description="Opens this video in YouTube\."/);
  assert.match(markup, /data-testid="video-open-youtube-recovery"/);
  assert.equal(typeof onPressCapture.current, "function");
  onPressCapture.current();
  assert.equal(activated, true, "The recovery button should invoke the YouTube action.");
  assert.match(
    videoSource,
    /playerFailed && !externalLinkError \? \([\s\S]*?<VideoEmbedFailureRecovery[\s\S]*?onOpenYouTube=\{\(\) => \{ void openOnYouTube\(\); \}\}/,
  );
});

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
  assert.match(errorMarkup, /data-testid="video-watch-error-message"/);
  assert.match(errorMarkup, /This video is unavailable\./);
  assert.match(errorMarkup, /role="text"/);
  assert.match(errorMarkup, /aria-live="polite"/);
  assert.equal(
    errorMarkup.match(/aria-live="polite"/g)?.length ?? 0,
    1,
    "The unavailable error should have exactly one polite announcement target.",
  );
  assert.doesNotMatch(
    renderError(rewardErrors.at(-1), false),
    /aria-live="polite"/,
    "Other reward errors should not reuse the start-failure announcement.",
  );

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
  const coinClaimRetryMarkup = renderCoinClaimRetry(null);
  assert.equal(coinClaimRetryMarkup, "");
  assert.doesNotMatch(coinClaimRetryMarkup, /video-retry-claim/);
  assert.match(
    renderCoinClaimRetry({ sessionId: "retryable-session", percent: 80 }),
    /data-testid="video-retry-claim"/,
    "The normal reward-claim retry should remain available when a claim can be retried.",
  );
  assert.ok(videoSource.includes(
    "const [retrySession, setRetrySession] = useState<{ sessionId: string; percent: number } | null>(null);",
  ));
  assert.match(videoSource, /VideoUnavailableErrorAnnouncement/);
  assert.match(
    videoSource,
    /accessibilityValue=\{\{ min: 0, max: 100, now: progressPercent \}\}/,
  );
  assert.match(videoSource, /testID="video-progress-value"/);

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
    shouldRefreshVideoCatalogOnFocus({
      isFocused: true,
      isAppActive: true,
      isPlayerOpen: false,
    }),
    true,
  );
  assert.equal(
    shouldRefreshVideoCatalogOnFocus({
      isFocused: true,
      isAppActive: true,
      isPlayerOpen: true,
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
  assert.match(
    videoSource,
    /AppState\.addEventListener\('change', \(nextState\) => \{\s*setIsAppActive\(nextState === 'active'\)/,
  );
  assert.match(
    videoSource,
    /shouldRefreshVideoCatalogOnFocus\(\{[\s\S]*?isPlayerOpen: showPlayer,[\s\S]*?\}\)\)\s*\{\s*void videosQuery\.refetch\(\)/,
  );
  assert.match(videoSource, /const videos: VideoItem\[\] = \(videosQuery\.data\?\.videos \?\? \[\]\)/);
  assert.match(videoSource, /filteredVideos\.map\(\(video\) =>/);
  assert.match(videoSource, /<VideoCatalogBackButton[\s\S]*?onPress=\{closePlayer\}/);
  assert.match(
    videoAccessibilityControlsSource,
    /accessibilityLabel="Back to videos"[\s\S]*?testID="video-catalog-back"/,
  );
  assert.match(
    videoAccessibilityControlsSource,
    /accessibilityRole="text"\s+accessibilityLiveRegion=\{announce \? 'polite' : undefined\}/,
  );
  assert.equal(
    videoAccessibilityControlsSource.match(/accessibilityLiveRegion/g)?.length ?? 0,
    2,
    "Each video failure component should provide only its own single live-region target.",
  );
  assert.match(nativeTestSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(nativeTestSource, /VideoUnavailableErrorAnnouncement/);
  assert.match(nativeTestSource, /shouldRefreshVideoCatalogOnFocus/);
  assert.match(maestroFlow, /video-watch-error-message/);
  assert.match(maestroFlow, /assertNotVisible:[\s\S]*?video-retry-claim/);
  assert.match(maestroFlow, /tapOn:[\s\S]*?video-catalog-back/);
  assert.match(maestroFlow, /video-catalog-refresh-state/);

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
  const state = {
    isFocused: true,
    isAppActive: true,
    isPlayerOpen: false,
  };
  const refreshInterval = () => getVideoCatalogRefreshInterval(state, 5);
  const queryOptions = {
    queryKey: ["video-catalog-refresh-regression"],
    queryFn: async () => {
      requestCount += 1;
      return activeVideos;
    },
    refetchInterval: refreshInterval(),
    refetchIntervalInBackground: false,
  };
  const observer = new QueryObserver(queryClient, queryOptions);
  const unsubscribe = observer.subscribe(() => {});

  await waitFor(
    () => observer.getCurrentResult().data?.[0]?.id === "disabled-video",
    "The catalog query should load the initially active video.",
  );
  // The Full Admin disables the listed video while the player catalog is backgrounded.
  activeVideos = [];
  state.isAppActive = false;
  observer.setOptions({ ...queryOptions, refetchInterval: refreshInterval() });
  const requestsBeforeBackgroundWait = requestCount;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    observer.getCurrentResult().data?.[0]?.id,
    "disabled-video",
    "The catalog should not poll or change its visible cards while the app is backgrounded.",
  );
  assert.equal(
    requestCount,
    requestsBeforeBackgroundWait,
    "Catalog polling should stop while the app is backgrounded.",
  );

  // Video.tsx reruns its focused-screen effect on this AppState transition and refetches.
  state.isAppActive = true;
  observer.setOptions({ ...queryOptions, refetchInterval: refreshInterval() });
  const requestsBeforeResume = requestCount;
  await observer.refetch();
  assert.ok(requestCount > requestsBeforeResume, "Resuming should trigger an immediate catalog request.");
  await waitFor(
    () => observer.getCurrentResult().data?.length === 0,
    "Resuming the app should promptly remove a video disabled by the admin.",
  );
  assert.ok(requestCount >= 2);

  activeVideos = [{ id: "player-disabled-video", title: "Video disabled while player is open" }];
  state.isPlayerOpen = true;
  observer.setOptions({
    ...queryOptions,
    refetchInterval: refreshInterval(),
  });
  const requestsWhenPlayerOpened = requestCount;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(requestCount, requestsWhenPlayerOpened, "Opening the player should stop catalog polling.");
  assert.equal(
    observer.getCurrentResult().data?.length,
    0,
    "The catalog should remain unchanged while the player is open.",
  );

  // Returning to the catalog restores polling and performs the screen's focus refetch.
  state.isPlayerOpen = false;
  observer.setOptions({ ...queryOptions, refetchInterval: refreshInterval() });
  const requestsBeforeReturningToCatalog = requestCount;
  await observer.refetch();
  assert.ok(
    requestCount > requestsBeforeReturningToCatalog,
    "Returning to the catalog should trigger an immediate request.",
  );
  assert.equal(
    observer.getCurrentResult().data?.[0]?.id,
    "player-disabled-video",
    "Returning from the player should refresh the catalog.",
  );

  unsubscribe();
  queryClient.clear();
});

test("a failed background catalog refresh preserves playable cards until a later refresh succeeds", async () => {
  assert.match(videoSource, /const hasLoadedCatalog = videosQuery\.data !== undefined/);
  assert.match(videoSource, /videosQuery\.isError && !hasLoadedCatalog/);
  assert.match(
    videoSource,
    /hasLoadedCatalog\s*\?\s*'Could not refresh videos\. Showing the last loaded catalog\.'/,
  );
  assert.ok(
    findJsxConditional("videos.length > 0"),
    "Loaded cards must remain rendered independently of the query error state.",
  );
  assert.match(videoSource, /selectedVideo = videos\.find\(\(video\) => video\.id === selectedVideoId\)/);
  assert.match(videoSource, /setSelectedVideoId\(video\.id\);\s*setShowPlayer\(true\)/);
  assert.match(videoSource, /!videosQuery\.isLoading && hasLoadedCatalog && videos\.length === 0/);

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
  const lastGoodCatalog = [{ id: "last-good", title: "Last good video", active: true }];
  const refreshedCatalog = [{ id: "refreshed", title: "Updated video", active: true }];
  let shouldFail = false;
  let catalog = lastGoodCatalog;
  const queryOptions = {
    queryKey: ["video-catalog-background-failure"],
    queryFn: async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Temporary network error");
      }
      return { videos: catalog };
    },
    retry: false,
    refetchInterval: false,
  };
  const observer = new QueryObserver(queryClient, queryOptions);
  const unsubscribe = observer.subscribe(() => {});

  await waitFor(
    () => observer.getCurrentResult().data?.videos?.[0]?.id === "last-good",
    "The catalog should first load the active video.",
  );
  catalog = refreshedCatalog;
  shouldFail = true;
  const failedRefresh = await observer.refetch();
  assert.ok(failedRefresh.error, "The simulated background refresh should fail.");
  assert.equal(observer.getCurrentResult().isError, true);
  assert.equal(
    observer.getCurrentResult().data?.videos?.[0]?.id,
    "last-good",
    "A failed refresh should retain the last successful response for the catalog and player.",
  );

  observer.setOptions({ ...queryOptions, refetchInterval: 10 });
  await waitFor(
    () => observer.getCurrentResult().data?.videos?.[0]?.id === "refreshed",
    "The next scheduled refresh should replace stale videos with the updated catalog.",
  );
  assert.equal(observer.getCurrentResult().isError, false);

  unsubscribe();
  queryClient.clear();
});
