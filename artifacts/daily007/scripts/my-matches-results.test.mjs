import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";
import { tournamentResultAccessibilityLabel } from "../src/lib/tournamentResultAccessibility.ts";

const myMatchesSource = readFileSync(
  new URL("../src/screens/MyMatches.tsx", import.meta.url),
  "utf8",
);
const resultAccessibilitySource = readFileSync(
  new URL("../src/lib/tournamentResultAccessibility.ts", import.meta.url),
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

function renderMatchCard(item) {
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
  const scope = {
    React,
    View,
    Text,
    GCard,
    Badge,
    Btn: () => null,
    RoomCredentialsPanel: () => null,
    tournamentResultAccessibilityLabel,
    C: { green: "green", red: "red", gold: "gold", orange: "orange" },
    s: new Proxy({}, { get: (_target, name) => String(name) }),
    fontScale: 1,
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

test("each result announces all standings details as one accessible row", () => {
  const rowMarker = "testID={`my-matches-result-${rank}-${index}`}";
  const markerIndex = myMatchesSource.indexOf(rowMarker);
  const rowStart = myMatchesSource.lastIndexOf("<View", markerIndex);
  const rowEnd = myMatchesSource.indexOf(">", markerIndex);

  assert.ok(markerIndex >= 0, "Each result row needs a stable test ID.");
  assert.ok(rowStart >= 0 && rowEnd > markerIndex, "Each result needs an accessible row wrapper.");
  const rowTag = myMatchesSource.slice(rowStart, rowEnd + 1);
  assert.match(rowTag, /\baccessible\b/);
  assert.match(rowTag, /accessibilityRole="text"/);
  assert.match(rowTag, /accessibilityLabel=\{tournamentResultAccessibilityLabel\(\{/);

  assert.equal(
    (rowTag.match(/accessibilityLabel=/g) ?? []).length,
    1,
    "A result should expose exactly one combined accessibility label.",
  );
  assert.equal(
    (myMatchesSource.match(/accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/g) ?? []).length,
    4,
    "The rank badge, initials, visible labels, and prize art must not create duplicate stops.",
  );
  assert.match(resultAccessibilitySource, /`Rank \$\{rank\}`/);
  assert.match(resultAccessibilitySource, /`Free Fire name \$\{describeValue\(gameName, 'unavailable'\)\}`/);
  assert.match(resultAccessibilitySource, /spokenTeam/);
  assert.match(resultAccessibilitySource, /spokenKills/);
  assert.match(resultAccessibilitySource, /`prize \$\{spokenPrize\}`/);
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
