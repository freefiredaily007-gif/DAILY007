import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import ts from "typescript";

const myMatchesSource = readFileSync(
  new URL("../src/screens/MyMatches.tsx", import.meta.url),
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
