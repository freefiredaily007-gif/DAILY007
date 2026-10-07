import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import { inr } from "../src/lib/coins.ts";
import {
  getTournamentResultsRefreshInterval,
  resolveTournamentWinnerState,
  TOURNAMENT_RESULTS_REFRESH_INTERVAL_MS,
} from "../src/lib/tournament-winner-details.ts";

const detailSource = readFileSync(
  new URL("../src/screens/TDetail.tsx", import.meta.url),
  "utf8",
);
const detailSourceFile = ts.createSourceFile(
  "TDetail.tsx",
  detailSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findWinnerUiNodes() {
  const initializers = new Map();
  let participantsMap;
  let winnerSection;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      initializers.set(node.name.text, node.initializer);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "participants" &&
      node.expression.name.text === "map"
    ) {
      participantsMap = node;
    }

    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      ts.isIdentifier(node.expression.left) &&
      node.expression.left.text === "isCompleted"
    ) {
      winnerSection = node.expression;
    }

    ts.forEachChild(node, visit);
  }

  visit(detailSourceFile);
  assert.ok(participantsMap, "TDetail should render its joined participants.");
  assert.ok(winnerSection, "TDetail should gate winner details on completion.");
  return { initializers, participantsMap, winnerSection };
}

function evaluateInitializer(name, scope, initializers) {
  const initializer = initializers.get(name);
  assert.ok(initializer, `TDetail should define ${name}.`);
  const source = initializer.getText(detailSourceFile);
  return new Function(...Object.keys(scope), `return (${source});`)(
    ...Object.values(scope),
  );
}

function renderJsxNode(node, scope) {
  const source = `const __fixtureElement = (${node.getText(detailSourceFile)});`;
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __fixtureElement;`,
  )(...Object.values(scope));
}

function renderWinnerFixture(fixture) {
  const { initializers, participantsMap, winnerSection } = findWinnerUiNodes();
  assert.ok(
    participantsMap.pos < winnerSection.pos,
    "TDetail should place the winner section after joined participants.",
  );

  const styles = {
    participantCard: { cardKind: "participant" },
    winnerCard: { cardKind: "winner" },
  };
  const buttons = [];
  const Card = ({ children, style }) => React.createElement(
    "article",
    { "data-card": style === styles.winnerCard ? "winner" : "participant" },
    children,
  );
  const View = ({ children }) => React.createElement("div", null, children);
  const Text = ({ children }) => React.createElement("span", null, children);
  const SectionTitle = ({ children }) => React.createElement("h2", null, children);
  const Btn = ({ children, title, onPress, testID, accessibilityState }) => {
    buttons.push({ accessibilityState, onPress, testID });
    return React.createElement(
      "button",
      { "data-testid": testID, onClick: onPress },
      children ?? title,
    );
  };
  const ActivityIndicator = () => React.createElement("span", null, "Loading");

  const resultsQuery = {
    data: {
      status: fixture.resultStatus ??
        (fixture.tournament.status === "completed" ? "finalized" : "draft"),
      entries: fixture.results,
    },
    isLoading: fixture.resultsLoading ?? false,
    isError: fixture.resultsError ?? false,
    isFetching: fixture.resultsFetching ?? false,
    refetch: fixture.refetchResults ?? (async () => {}),
  };
  const isCompleted = evaluateInitializer(
    "isCompleted",
    {
      t: fixture.tournament,
      resultsQuery,
    },
    initializers,
  );
  const winnerState = evaluateInitializer(
    "winnerState",
    { resultsQuery, isCompleted, resolveTournamentWinnerState },
    initializers,
  );
  const winner = evaluateInitializer("winner", { winnerState }, initializers);
  const winnerGameName = evaluateInitializer("winnerGameName", { winner }, initializers);
  const winnerTeamName = evaluateInitializer("winnerTeamName", { winner }, initializers);
  const winnerName = evaluateInitializer(
    "winnerName",
    { winnerTeamName, winnerGameName },
    initializers,
  );
  const scope = {
    React,
    Card,
    View,
    Text,
    SectionTitle,
    C: { gold: "#gold" },
    s: styles,
    participants: fixture.participants,
    teamTournament: fixture.teamTournament,
    isCompleted,
    winnerState,
    winner,
    winnerName,
    winnerTeamName,
    winnerGameName,
    ActivityIndicator,
    Btn,
    resultsQuery,
    inr,
  };

  const screenElements = [
    { position: participantsMap.pos, element: renderJsxNode(participantsMap, scope) },
    { position: winnerSection.pos, element: renderJsxNode(winnerSection, scope) },
  ]
    .sort((left, right) => left.position - right.position)
    .map(({ element }) => element);
  const markup = renderToStaticMarkup(
    React.createElement(React.Fragment, null, ...screenElements),
  );
  return { buttons, isCompleted, markup, winnerState };
}

function getWinnerCardMarkup(markup) {
  const start = markup.indexOf('<article data-card="winner">');
  if (start < 0) return "";
  const close = markup.indexOf("</article>", start);
  return close < 0 ? "" : markup.slice(start, close + "</article>".length);
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("a completed solo winner shows the game name and coin/INR award after joined players", () => {
  const rendered = renderWinnerFixture({
    tournament: { status: "completed" },
    participants: [{ players: ["Joined Solo Player"], status: "approved" }],
    teamTournament: false,
    results: [{ rank: 1, gameName: "Solo Champion", teamName: "", prizeCoins: 125 }],
  });
  const card = getWinnerCardMarkup(rendered.markup);

  assert.equal(rendered.isCompleted, true);
  assert.equal(rendered.winnerState.kind, "winner");
  assert.ok(card.includes("Solo Champion"));
  assert.ok(card.includes("125 coins"));
  assert.ok(card.includes(inr(125)));
  assert.ok(
    rendered.markup.indexOf("Joined Solo Player") < rendered.markup.indexOf('data-card="winner"'),
  );
});

test("an open tournament reveals the winner when active result refresh sees a finalized result", () => {
  const rendered = renderWinnerFixture({
    tournament: { status: "ongoing" },
    resultStatus: "finalized",
    participants: [{ players: ["Joined Player"], status: "approved" }],
    teamTournament: false,
    results: [{ rank: 1, gameName: "New Champion", prizeCoins: 250 }],
  });
  const card = getWinnerCardMarkup(rendered.markup);

  assert.equal(rendered.isCompleted, true);
  assert.ok(card.includes("New Champion"));
  assert.ok(card.includes("250 coins"));
  assert.ok(card.includes(inr(250)));
});

test("a completed team winner shows its team, captain handle, and coin/INR award", () => {
  const rendered = renderWinnerFixture({
    tournament: { status: "completed" },
    participants: [{
      teamName: "Joined Squad",
      players: ["Captain Handle", "Teammate Handle"],
      status: "approved",
    }],
    teamTournament: true,
    results: [{
      rank: 1,
      gameName: "Captain Handle",
      teamName: "Sky Falcons",
      prizeCoins: 375,
    }],
  });
  const card = getWinnerCardMarkup(rendered.markup);

  assert.equal(rendered.isCompleted, true);
  assert.ok(card.includes("Sky Falcons"));
  assert.ok(card.includes("CAPTAIN · Captain Handle"));
  assert.ok(card.includes("375 coins"));
  assert.ok(card.includes(inr(375)));
  assert.ok(
    rendered.markup.indexOf("Joined Squad") < rendered.markup.indexOf('data-card="winner"'),
  );
});

test("an unfinished tournament does not render a winner card even if rank-one results exist", () => {
  const rendered = renderWinnerFixture({
    tournament: { status: "ongoing" },
    participants: [{ players: ["Joined Player"], status: "approved" }],
    teamTournament: false,
    results: [{ rank: 1, gameName: "Premature Winner", prizeCoins: 999 }],
  });

  assert.equal(rendered.isCompleted, false);
  assert.equal(rendered.winnerState.kind, "winner");
  assert.equal(getWinnerCardMarkup(rendered.markup), "");
  assert.doesNotMatch(rendered.markup, /WINNER &amp; PRIZE|TOURNAMENT WINNER|999 coins/);
});

test("a completed match without rank one shows the no-winner message and no winner award", () => {
  const rendered = renderWinnerFixture({
    tournament: { status: "completed" },
    participants: [{ players: ["Joined Player"], status: "approved" }],
    teamTournament: false,
    results: [
      { rank: 2, gameName: "Second Place", prizeCoins: 50 },
      { rank: 3, gameName: "Third Place", prizeCoins: 25 },
    ],
  });

  assert.equal(rendered.isCompleted, true);
  assert.deepEqual(rendered.winnerState, { kind: "no-winner" });
  assert.match(rendered.markup, /No winner was recorded for this completed match\./);
  assert.equal(getWinnerCardMarkup(rendered.markup), "");
  assert.doesNotMatch(
    rendered.markup,
    /TOURNAMENT WINNER|PRIZE WON|50 coins|25 coins|Second Place|Third Place/,
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

test("a rendered winner error hides stale details and retry reveals the recovered award", async () => {
  let refetchCalls = 0;
  const fixture = {
    tournament: { status: "completed" },
    participants: [],
    teamTournament: false,
    resultsError: true,
    results: [{ rank: 1, gameName: "Stale Champion", prizeCoins: 75 }],
    refetchResults: () => {
      refetchCalls += 1;
      fixture.resultsError = false;
      fixture.results = [{
        rank: 1,
        gameName: "Current Champion",
        prizeCoins: 125,
      }];
      return Promise.resolve();
    },
  };

  const failed = renderWinnerFixture(fixture);
  const retryButton = failed.buttons.find(
    ({ testID }) => testID === "winner-results-retry",
  );

  assert.equal(failed.winnerState.kind, "error");
  assert.match(
    failed.markup,
    /Winner and prize details couldn’t be loaded\. Retry here or pull down to try again\./,
  );
  assert.match(failed.markup, /data-testid="winner-results-retry"/);
  assert.match(failed.markup, /RETRY WINNER DETAILS/);
  assert.ok(retryButton, "the winner-details retry button should be rendered");
  assert.equal(typeof retryButton.onPress, "function");
  assert.equal(getWinnerCardMarkup(failed.markup), "");
  assert.doesNotMatch(
    failed.markup,
    /Stale Champion|75 coins|TOURNAMENT WINNER|PRIZE WON/,
  );
  assert.doesNotMatch(failed.markup, new RegExp(inr(75)));

  retryButton.onPress();
  await Promise.resolve();
  assert.equal(refetchCalls, 1, "retry should call resultsQuery.refetch()");

  const recovered = renderWinnerFixture(fixture);
  const winnerCard = getWinnerCardMarkup(recovered.markup);
  assert.equal(recovered.winnerState.kind, "winner");
  assert.match(winnerCard, /Current Champion/);
  assert.match(winnerCard, /125 coins/);
  assert.ok(winnerCard.includes(inr(125)));
  assert.doesNotMatch(recovered.markup, /Stale Champion|75 coins/);
});

test("winner-details retry exposes busy state only while the request is fetching", async () => {
  let resolveRefetch;
  let refetchCalls = 0;
  const refetchPromise = new Promise((resolve) => {
    resolveRefetch = resolve;
  });
  const fixture = {
    tournament: { status: "completed" },
    participants: [],
    teamTournament: false,
    resultsError: true,
    resultsFetching: false,
    results: [],
    refetchResults: () => {
      refetchCalls += 1;
      return refetchPromise;
    },
  };

  const failed = renderWinnerFixture(fixture);
  const retryButton = failed.buttons.find(
    ({ testID }) => testID === "winner-results-retry",
  );
  assert.deepEqual(retryButton?.accessibilityState, { busy: false });
  assert.match(failed.markup, /RETRY WINNER DETAILS/);

  retryButton.onPress();
  fixture.resultsFetching = true;
  const retrying = renderWinnerFixture(fixture);
  const retryingButton = retrying.buttons.find(
    ({ testID }) => testID === "winner-results-retry",
  );
  assert.deepEqual(retryingButton?.accessibilityState, { busy: true });
  assert.match(retrying.markup, /RETRY WINNER DETAILS/);
  assert.equal(refetchCalls, 1);

  resolveRefetch();
  await refetchPromise;
  fixture.resultsFetching = false;
  const settled = renderWinnerFixture(fixture);
  const settledButton = settled.buttons.find(
    ({ testID }) => testID === "winner-results-retry",
  );
  assert.deepEqual(settledButton?.accessibilityState, { busy: false });
});

test("tournament result status and winner details poll only while focused without overlapping requests", async () => {
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
    assert.equal(getTournamentResultsRefreshInterval(false), false);
    assert.equal(
      getTournamentResultsRefreshInterval(true),
      TOURNAMENT_RESULTS_REFRESH_INTERVAL_MS,
    );
    assert.match(
      detailSource,
      /const isCompleted =[\s\S]*resultsQuery\.data\?\.status[\s\S]*finalized/,
      "TDetail should treat finalized result data as the completion update",
    );
    assert.match(
      detailSource,
      /enabled: Boolean\(id\) && isFocused/,
      "the result status query should only run while the detail screen is active",
    );
    assert.match(
      detailSource,
      /refetchInterval: getTournamentResultsRefreshInterval\(isFocused\)/,
      "status refresh should use the focus-aware polling interval",
    );

    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = ["tournament-results-active-screen"];
    const oldResults = {
      status: "draft",
      entries: [{ rank: 1, gameName: "Old Winner", prizeCoins: 75 }],
    };
    const currentResults = {
      status: "finalized",
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
      refetchInterval: getTournamentResultsRefreshInterval(focused)
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
    assert.equal(observer.getCurrentResult().data.status, "finalized");
    assert.equal(maxActiveRequests, 1, "polling should not start overlapping result requests");
    const refreshedScreen = renderWinnerFixture({
      tournament: { status: "ongoing" },
      resultStatus: observer.getCurrentResult().data.status,
      participants: [],
      teamTournament: false,
      results: observer.getCurrentResult().data.entries,
    });
    const refreshedWinnerCard = getWinnerCardMarkup(refreshedScreen.markup);
    assert.equal(refreshedScreen.isCompleted, true);
    assert.ok(refreshedWinnerCard.includes("Corrected Winner"));
    assert.ok(refreshedWinnerCard.includes("125 coins"));

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