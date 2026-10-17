import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import { tournamentResultAccessibilityLabel } from "../src/lib/tournamentResultAccessibility.ts";
import {
  MY_MATCHES_TEXT_SCALE_INDIVIDUAL_REGISTRATIONS,
  MY_MATCHES_TEXT_SCALE_RESULTS,
} from "../src/lib/myMatchesTextScaleFixture.ts";

const myMatchesSource = readFileSync(
  new URL("../src/screens/MyMatches.tsx", import.meta.url),
  "utf8",
);
const resultAccessibilitySource = readFileSync(
  new URL("../src/lib/tournamentResultAccessibility.ts", import.meta.url),
  "utf8",
);
const resultRowSource = readFileSync(
  new URL("../src/components/TournamentResultRow.tsx", import.meta.url),
  "utf8",
);
const nativeTextScaleScreenSource = readFileSync(
  new URL("../src/screens/MyMatchesNativeTextScaleTest.tsx", import.meta.url),
  "utf8",
);
const nativeTextScaleFlow = readFileSync(
  new URL("../maestro/my-matches-native-text-scale/large-text.yaml", import.meta.url),
  "utf8",
);
const nativeIndividualTextScaleFlow = readFileSync(
  new URL("../maestro/my-matches-native-text-scale/individual-result-large-text.yaml", import.meta.url),
  "utf8",
);
const nativeTextScaleRunner = readFileSync(
  new URL("./run-android-my-matches-large-text.mjs", import.meta.url),
  "utf8",
);
const myMatchesSourceFile = ts.createSourceFile(
  "MyMatches.tsx",
  myMatchesSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findRenderItemCallback() {
  let renderItemCallback;

  function visit(node) {
    if (
      ts.isJsxAttribute(node)
      && node.name.getText(myMatchesSourceFile) === "renderItem"
      && node.initializer
      && ts.isJsxExpression(node.initializer)
      && node.initializer.expression
      && ts.isArrowFunction(node.initializer.expression)
    ) {
      renderItemCallback = node.initializer.expression;
    }
    ts.forEachChild(node, visit);
  }

  visit(myMatchesSourceFile);
  assert.ok(renderItemCallback, "My Matches should render cards from its FlatList renderItem.");
  return renderItemCallback;
}

function renderMatchCard(item, { fontScale = 1 } = {}) {
  const callback = findRenderItemCallback();
  const javascript = ts.transpileModule(
    `const __renderItem = (${callback.getText(myMatchesSourceFile)});`,
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  const View = ({ children }) => React.createElement("div", null, children);
  const Text = ({ children }) => React.createElement("span", null, children);
  const GCard = ({ children }) => React.createElement("article", null, children);
  const Badge = ({ text }) => React.createElement("span", null, text);
  const TournamentResultRow = ({ entry, index, fontScale }) => React.createElement(
    "div",
    {
      role: "text",
      "aria-label": tournamentResultAccessibilityLabel({
        rank: entry.rank ?? index + 1,
        gameName: entry.gameName,
        teamName: entry.teamName,
        kills: entry.kills,
        prizeCoins: entry.prizeCoins,
      }),
      "data-font-scale": fontScale,
    },
    entry.rank ?? index + 1,
    entry.gameName || entry.teamName || "Player",
    entry.teamName ? `TEAM ${entry.teamName}` : "",
    entry.kills != null ? `${entry.kills} KILLS` : "",
    "Prize Won",
    entry.prizeCoins ?? 0,
    index,
  );
  const scope = {
    React,
    View,
    Text,
    GCard,
    Badge,
    TournamentResultRow,
    Btn: () => null,
    RoomCredentialsPanel: () => null,
    tournamentResultAccessibilityLabel,
    C: { green: "green", red: "red", gold: "gold", orange: "orange" },
    s: new Proxy({}, { get: (_target, name) => String(name) }),
    fontScale,
    clockNow: Date.now(),
    navigation: { navigate() {} },
    getTournamentLifecycleState: () => "completed",
    getRoomCredentialSchedule: () => null,
    canEditRegistrationTeam: () => false,
    getTeamEditCutoff: () => null,
    hasServerAuthorizedRoomCredentials: () => false,
    fmtDate: () => "Oct 6",
    fmtTime12: () => "6:00 PM",
  };
  const renderItem = new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __renderItem;`,
  )(...Object.values(scope));

  return renderToStaticMarkup(renderItem({ item }));
}

test("My Matches results show Free Fire details without the account profile name", () => {
  const profileName = "Daily007 Profile Name";
  const markup = renderMatchCard({
    id: "registration-1",
    status: "approved",
    playerName: profileName,
    teamName: "Blue Fire",
    tournament: {
      mode: "battle royale",
      teamType: "squad",
      name: "Sunday Clash",
      status: "completed",
      results: [{
        rank: 2,
        kills: 5,
        prizeCoins: 50,
        gameName: "FireCaptain",
        teamName: "Blue Fire",
        playerName: profileName,
      }],
    },
  });
  const renderedText = markup.replace(/<[^>]*>/g, "");

  assert.match(renderedText, /FireCaptain/, "The card should show the Free Fire name.");
  assert.match(renderedText, /TEAM Blue Fire/, "The result should show the team name.");
  assert.ok(renderedText.includes("2"), "The result should show rank 2.");
  assert.match(renderedText, /5 KILLS/, "The result should show kills.");
  assert.match(renderedText, /50/, "The result should show the coin prize.");
  assert.match(renderedText, /Prize Won/, "The prize amount should be identified as a prize.");
  assert.doesNotMatch(
    renderedText,
    new RegExp(profileName),
    "The account profile name must not appear in rendered card text.",
  );
});

test("My Matches shows an individual result clearly when tournament standings are empty at 1.5×", () => {
  const profileName = "Daily007 Profile Name";
  const markup = renderMatchCard({
    id: "registration-individual-result",
    status: "approved",
    playerName: profileName,
    result: "Rank 2 · 3 kills · 600 coins",
    resultDetails: {
      rank: 2,
      kills: 3,
      prizeCoins: 600,
      gameName: "RunnerUpFF",
      teamName: "Blue Fire",
      playerName: profileName,
    },
    tournament: {
      mode: "battle royale",
      teamType: "squad",
      name: "Sunday Clash",
      status: "completed",
      results: [],
    },
  }, { fontScale: 1.5 });
  const renderedText = markup.replace(/<[^>]*>/g, "");

  assert.match(markup, /data-font-scale="1\.5"/);
  assert.match(renderedText, /YOUR RESULT/, "The fallback should identify the individual result.");
  assert.match(renderedText, /RunnerUpFF/, "The fallback should show the Free Fire name.");
  assert.match(renderedText, /TEAM Blue Fire/, "The fallback should show the team.");
  assert.match(renderedText, /2/, "The fallback should show rank 2.");
  assert.match(renderedText, /3 KILLS/, "The fallback should show kills.");
  assert.match(renderedText, /600/, "The fallback should show the prize amount.");
  assert.match(renderedText, /Prize Won/, "The amount should be explicitly identified as a prize.");
  assert.equal((markup.match(/role="text"/g) ?? []).length, 1, "The individual result should be one spoken stop.");
  assert.match(
    markup,
    /aria-label="Rank 2, Free Fire name RunnerUpFF, team Blue Fire, 3 kills, prize 600 coins"/,
    "The one spoken label should identify rank, kills, and prize without the account name.",
  );
  assert.doesNotMatch(renderedText, new RegExp(profileName));
  assert.doesNotMatch(markup, new RegExp(profileName));
});

test("completed long-name results preserve all details and one spoken stop at 1.5×", () => {
  const entry = MY_MATCHES_TEXT_SCALE_RESULTS[0];
  const markup = renderMatchCard({
    id: "registration-large-text",
    status: "approved",
    tournament: {
      mode: "battle royale",
      teamType: "squad",
      name: "Large Text Clash",
      status: "completed",
      results: [entry],
    },
  }, { fontScale: 1.5 });
  const renderedText = markup.replace(/<[^>]*>/g, "");

  assert.match(markup, /data-font-scale="1\.5"/, "The completed result should receive the active 1.5× font scale.");
  assert.equal((markup.match(/role="text"/g) ?? []).length, 1, "Each result should remain one accessible stop.");
  assert.match(
    markup,
    new RegExp(`aria-label="Rank ${entry.rank}, Free Fire name ${entry.gameName}, team ${entry.teamName}, ${entry.kills} kills, prize ${entry.prizeCoins} coins"`),
    "The single spoken label should retain rank, player, team, kills, and prize.",
  );
  assert.ok(renderedText.includes(String(entry.rank)), "The visible result should include its rank.");
  assert.ok(renderedText.includes(entry.gameName), "The visible result should include the long Free Fire name.");
  assert.ok(renderedText.includes(`TEAM ${entry.teamName}`), "The visible result should include the long team name.");
  assert.ok(renderedText.includes(`${entry.kills} KILLS`), "The visible result should include kills.");
  assert.ok(renderedText.includes(String(entry.prizeCoins)), "The visible result should include the prize amount.");
  assert.match(renderedText, /Prize Won/, "The prize amount should remain identified.");
});

test("cancelled My Matches cards announce the refund state without archived awards", () => {
  const markup = renderMatchCard({
    id: "registration-cancelled",
    status: "approved",
    result: "Old published result",
    tournament: {
      mode: "battle royale",
      teamType: "squad",
      name: "Cancelled Clash",
      status: "cancelled",
      results: [{
        rank: 1,
        kills: 17,
        prizeCoins: 900,
        gameName: "ArchivedWinner",
        teamName: "Archived Team",
      }],
    },
  });
  const renderedText = markup.replace(/<[^>]*>/g, "");

  assert.match(renderedText, /CANCELLED/, "The card should announce its cancelled state.");
  assert.match(
    renderedText,
    /Any entry fee paid was refunded to the paying account\./,
    "The card should announce the refund information.",
  );
  assert.doesNotMatch(
    renderedText,
    /TOURNAMENT RESULTS|Old published result|ArchivedWinner|Archived Team|17 KILLS|900/,
    "Cancelled cards must not render or announce an old award.",
  );
});

test("each result announces all standings details as one accessible row", () => {
  const rowMarker = "testID={`my-matches-result-${rank}-${index}`}";
  const markerIndex = resultRowSource.indexOf(rowMarker);
  const rowStart = resultRowSource.lastIndexOf("<View", markerIndex);
  const rowEnd = resultRowSource.indexOf(">", markerIndex);

  assert.ok(markerIndex >= 0, "Each result row needs a stable test ID.");
  assert.ok(rowStart >= 0 && rowEnd > markerIndex, "Each result needs an accessible row wrapper.");
  const rowTag = resultRowSource.slice(rowStart, rowEnd + 1);
  assert.match(rowTag, /\baccessible\b/);
  assert.match(rowTag, /accessibilityRole="text"/);
  assert.match(rowTag, /accessibilityLabel=\{tournamentResultAccessibilityLabel\(\{/);

  assert.equal(
    (rowTag.match(/accessibilityLabel=/g) ?? []).length,
    1,
    "A result should expose exactly one combined accessibility label.",
  );
  assert.equal(
    (resultRowSource.match(/accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/g) ?? []).length,
    4,
    "The rank badge, initials, visible labels, and prize art must not create duplicate stops.",
  );
  assert.match(resultAccessibilitySource, /`Rank \$\{rank\}`/);
  assert.match(resultAccessibilitySource, /`Free Fire name \$\{describeValue\(gameName, 'unavailable'\)\}`/);
  assert.match(resultAccessibilitySource, /spokenTeam/);
  assert.match(resultAccessibilitySource, /spokenKills/);
  assert.match(resultAccessibilitySource, /`prize \$\{spokenPrize\}`/);
});

test("large-text result rows stack prize details below the wrapping player and team names", () => {
  assert.match(myMatchesSource, /<TournamentResultRow[\s\S]*?fontScale=\{fontScale\}/);
  assert.match(resultRowSource, /const largeText = fontScale >= 1\.5/);
  assert.match(resultRowSource, /resultRowLarge: \{[\s\S]*?flexDirection: 'column'[\s\S]*?alignItems: 'stretch'/);
  assert.match(resultRowSource, /resultMainLarge: \{ flex: 0, width: '100%'/);
  assert.match(resultRowSource, /prizeWrapLarge: \{ marginLeft: 92,[\s\S]*?alignSelf: 'stretch'/);
  assert.match(resultRowSource, /resultName: \{[^}]*flexShrink: 1/);
  assert.match(resultRowSource, /resultKills: \{[^}]*flexShrink: 1/);
  assert.match(resultRowSource, /onTextLayout=\{onLayoutProbe \? report\('nameLines'\)/);
  assert.match(resultRowSource, /onTextLayout=\{onLayoutProbe \? report\('detailsLines'\)/);
});

test("native Android fixture verifies wrapping bounds and can scroll to every result row", () => {
  assert.match(nativeTextScaleScreenSource, /MY_MATCHES_TEXT_SCALE_RESULTS/);
  assert.match(nativeTextScaleScreenSource, /Number\(result\.nameLines\) > 1/);
  assert.match(nativeTextScaleScreenSource, /Number\(result\.detailsLines\) > 1/);
  assert.match(nativeTextScaleScreenSource, /fitsWithin\(rank, main\)/);
  assert.match(nativeTextScaleScreenSource, /fitsWithin\(rankText, rank\)/);
  assert.match(nativeTextScaleScreenSource, /fitsWithin\(name, identity\)/);
  assert.match(nativeTextScaleScreenSource, /fitsWithin\(details, identity\)/);
  assert.match(nativeTextScaleScreenSource, /details\.y >= name\.y \+ name\.height/);
  assert.match(nativeTextScaleScreenSource, /fitsWithin\(prizeAmount, prizeAmountRow\)/);
  assert.match(nativeTextScaleScreenSource, /prizeLabel\.y >= prizeAmountRow\.y \+ prizeAmountRow\.height/);
  assert.match(nativeTextScaleScreenSource, /prize\.y >= main\.y \+ main\.height/);
  assert.match(nativeTextScaleScreenSource, /All 10 result rows fit within bounds at 2\.00×/);
  assert.match(nativeTextScaleRunner, /font_scale', String\(testCase\.scale\)/);
  assert.match(nativeTextScaleRunner, /maestro\/my-matches-native-text-scale\/large-text\.yaml/);
  assert.match(nativeTextScaleRunner, /finally\s*\{[\s\S]*?originalFontScale/);
  assert.match(nativeTextScaleRunner, /Could not verify restoration of Android font scale/);

  for (let rank = 1; rank <= 10; rank += 1) {
    assert.ok(nativeTextScaleFlow.includes(`id: my-matches-result-${rank}-${rank - 1}`));
    assert.ok(nativeTextScaleFlow.includes(`Rank ${rank}, Free Fire name International Free Fire Champion With A Name That Wraps Across The Result Card ${rank}`));
    assert.ok(nativeTextScaleFlow.includes(`team Blue Phoenix Squad With A Long Tournament Team Name ${rank}`));
  }
});

test("native Android fixture verifies empty-standings individual cards fit and scroll at 1.5×", () => {
  assert.equal(MY_MATCHES_TEXT_SCALE_INDIVIDUAL_REGISTRATIONS.length, 10);
  for (const registration of MY_MATCHES_TEXT_SCALE_INDIVIDUAL_REGISTRATIONS) {
    assert.deepEqual(registration.tournament.results, [], "The fixture must exercise the empty-standings fallback.");
    assert.ok(registration.resultDetails.rank, "Each fallback card should have an individual rank.");
  }

  assert.match(nativeTextScaleScreenSource, /registration\.tournament\.results\.length === 0/);
  assert.match(nativeTextScaleScreenSource, /fitsWithin\(row, card\)/);
  assert.match(nativeTextScaleScreenSource, /fitsWithin\(heading, card\)/);
  assert.match(nativeTextScaleScreenSource, /row\.y >= heading\.y \+ heading\.height/);
  assert.match(nativeTextScaleScreenSource, /All 10 individual result cards fit within bounds at 1\.50×/);
  assert.match(nativeTextScaleRunner, /scale: 1\.5/);
  assert.match(nativeTextScaleRunner, /my-matches-native-text-scale\/individual-result-large-text\.yaml/);
  assert.match(nativeIndividualTextScaleFlow, /font scale 1\.50/);
  assert.match(nativeIndividualTextScaleFlow, /All 10 individual result cards fit within bounds at 1\.50×/);
  assert.match(nativeIndividualTextScaleFlow, /YOUR RESULT/);

  for (let rank = 1; rank <= 10; rank += 1) {
    assert.ok(nativeIndividualTextScaleFlow.includes(`id: my-matches-individual-result-card-${rank}`));
    assert.ok(nativeIndividualTextScaleFlow.includes(`Rank ${rank}, Free Fire name International Free Fire Champion With A Name That Wraps Across The Result Card ${rank}`));
  }
});

test("the spoken result includes all expected details and excludes the account profile name", () => {
  const profileName = "Daily007 Profile Name";
  const label = tournamentResultAccessibilityLabel({
    rank: 2,
    gameName: "FireCaptain",
    teamName: "Blue Fire",
    kills: 5,
    prizeCoins: 50,
    playerName: profileName,
  });

  assert.equal(
    label,
    "Rank 2, Free Fire name FireCaptain, team Blue Fire, 5 kills, prize 50 coins",
  );
  assert.doesNotMatch(label, new RegExp(profileName));
});
