import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import { getCreditedVideoWatchSeconds } from "../src/lib/video-watch-progress.ts";

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

function renderClaimRetry(retrySession) {
  const element = evaluateJsxConditional(findJsxConditional("retrySession"), {
    React,
    retrySession,
    Pressable: ({ children, testID }) => React.createElement(
      "button",
      testID ? { "data-testid": testID } : undefined,
      children,
    ),
    Text: createTestText,
    Feather: () => null,
    styles: { retryButton: {}, externalButtonText: {} },
    rewardPending: false,
    claimViewReward() {},
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

test("an unavailable start error is shown and permanently stops that playback attempt", async () => {
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
  const lastSampleRef = { current: null };
  const progressWrites = [];
  const rewardErrors = [];
  const retrySessionWrites = [];
  const startRequests = [];
  let creditedSecondsCalls = 0;
  const handlePlayerMessage = loadScreenCallback("handlePlayerMessage", {
    showPlayer: true,
    selectedVideo: { id: "disabled-video" },
    ENDED_STATE: 0,
    PLAYING_STATE: 1,
    finishCurrentPlayback() {},
    setPlayerReady() {},
    setPlayerFailed() {},
    appIsActiveRef,
    currentSessionRef,
    lastSampleRef,
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
    createVideoWatchAttemptId: () => "attempt-identity-for-disabled-video",
    startVideoWatch: ({ data }) => {
      startRequests.push(data);
      return Promise.reject(unavailableResponse);
    },
    apiError,
    getCreditedVideoWatchSeconds: (...args) => {
      creditedSecondsCalls += 1;
      return getCreditedVideoWatchSeconds(...args);
    },
    setRetrySession: (value) => retrySessionWrites.push(value),
  });

  handlePlayerMessage({
    type: "progress",
    currentTime: 12,
    duration: 60,
    playing: true,
  });
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
    videoId: "disabled-video",
    durationSeconds: 60,
    attemptId: "attempt-identity-for-disabled-video",
  }]);

  const errorMarkup = renderError(rewardErrors.at(-1));
  assert.match(errorMarkup, /data-testid="video-watch-error"/);
  assert.match(errorMarkup, /This video is unavailable\./);

  handlePlayerMessage({
    type: "progress",
    currentTime: 13,
    duration: 60,
    playing: true,
  });

  assert.deepEqual(progressWrites, [0], "Progress should stay at zero after the rejected start.");
  assert.equal(progressPercentRef.current, 0);
  assert.equal(watchedSecondBucketsRef.current.size, 0);
  assert.equal(creditedSecondsCalls, 0, "Rejected playback samples must not be credited.");
  assert.equal(startRequests.length, 1, "The same failed playback should not automatically start again.");
  assert.deepEqual(retrySessionWrites, [], "A start failure must not create a reward-claim retry.");
  assert.ok(videoSource.includes(
    "const [retrySession, setRetrySession] = useState<{ sessionId: string; percent: number } | null>(null);",
  ));

  const retryMarkup = renderClaimRetry(null);
  assert.doesNotMatch(retryMarkup, /video-retry-claim|RETRY COIN CLAIM/);
});

test("returning from a stale player refreshes the active catalog", async () => {
  const activeVideos = [{ id: "still-active-video", title: "Current catalog video" }];
  const query = {
    data: { videos: [{ id: "disabled-video", title: "Stale catalog card" }] },
    refetch: async () => {
      query.data = { videos: activeVideos };
      return { data: query.data };
    },
  };
  const state = {
    showPlayer: true,
    selectedVideoId: "disabled-video",
    retrySession: { sessionId: "stale-session", percent: 80 },
  };
  let refreshCount = 0;
  const videosQuery = {
    get data() {
      return query.data;
    },
    refetch: () => {
      refreshCount += 1;
      return query.refetch();
    },
  };
  const closePlayer = loadScreenCallback("closePlayer", {
    playbackCycleRef: { current: 0 },
    setShowPlayer: (value) => { state.showPlayer = value; },
    setSelectedVideoId: (value) => { state.selectedVideoId = value; },
    setRetrySession: (value) => { state.retrySession = value; },
    videosQuery,
  });

  closePlayer();
  await waitFor(
    () => query.data.videos[0]?.id === "still-active-video",
    "Returning to the catalog should replace the stale video list with the active list.",
  );

  assert.equal(refreshCount, 1);
  assert.equal(state.showPlayer, false);
  assert.equal(state.selectedVideoId, null);
  assert.equal(state.retrySession, null);
  assert.deepEqual(videosQuery.data.videos, activeVideos);
  assert.match(videoSource, /testID="video-catalog-back"[^>]*onPress=\{closePlayer\}/);
  assert.match(videoSource, /const videos: VideoItem\[\] = \(videosQuery\.data\?\.videos \?\? \[\]\)/);
  assert.match(videoSource, /filteredVideos\.map\(\(video\) =>/);
});
