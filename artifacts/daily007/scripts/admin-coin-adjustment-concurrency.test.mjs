import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { runOnceWhileInFlight } from "../src/lib/inFlightAction.ts";

const screens = [
  ["AdminWallet", "../src/screens/AdminWallet.tsx"],
  ["AdminUsers", "../src/screens/AdminUsers.tsx"],
];

function findSubmitAdjustment(sourceFile) {
  let declaration = null;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "submitAdjustment"
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(declaration?.initializer, "Expected submitAdjustment callback.");
  assert.ok(
    ts.isArrowFunction(declaration.initializer),
    "submitAdjustment should remain a directly testable async callback.",
  );
  return declaration.initializer;
}

function loadSubmitAdjustment(source, screenName) {
  const sourceFile = ts.createSourceFile(
    `${screenName}.tsx`,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const callback = findSubmitAdjustment(sourceFile);
  const javascript = ts.transpileModule(
    `const __callback = (${callback.getText(sourceFile)});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  let resolveFirstRequest;
  const calls = [];
  const inFlight = new Set();
  const scope = {
    Api: {
      adminAdjustCoins: (...args) => {
        calls.push(args);
        if (calls.length === 1) {
          return new Promise((resolve) => {
            resolveFirstRequest = resolve;
          });
        }
        return Promise.resolve({});
      },
    },
    busy: null,
    coinAdjustmentsInFlight: { current: inFlight },
    inFlightActions: inFlight,
    errMessage: (error) => String(error),
    load: () => Promise.resolve(),
    runOnceWhileInFlight,
    setBusy: () => {},
    setRetryAdjustment: () => {},
    toast: () => {},
  };
  const submitAdjustment = new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __callback;`,
  )(...Object.values(scope));

  return {
    calls,
    inFlight,
    resolveFirstRequest: () => resolveFirstRequest({}),
    submitAdjustment,
  };
}

for (const [screenName, sourcePath] of screens) {
  test(`${screenName} ignores a same-user repeat while an Admin coin change is pending`, async () => {
    const source = await readFile(new URL(sourcePath, import.meta.url), "utf8");
    const harness = loadSubmitAdjustment(source, screenName);
    const adjustment = {
      user: { $id: "player-1", name: "Player One" },
      delta: 20,
      amount: 20,
      note: "Admin added coins",
      requestId: "first-request",
    };
    const inFlightKey = screenName === "AdminWallet" ? "wallet:player-1" : "player-1";

    const firstSubmission = harness.submitAdjustment(adjustment);
    assert.equal(harness.calls.length, 1);
    assert.ok(harness.inFlight.has(inFlightKey));

    await harness.submitAdjustment({
      ...adjustment,
      requestId: "different-request-from-fast-repeat",
    });
    assert.equal(
      harness.calls.length,
      1,
      "the second tap must not send another request with a new idempotency key",
    );

    harness.resolveFirstRequest();
    await firstSubmission;
    assert.equal(harness.inFlight.has(inFlightKey), false);

    await harness.submitAdjustment({
      ...adjustment,
      requestId: "intentional-later-adjustment",
    });
    assert.equal(
      harness.calls.length,
      2,
      "a new adjustment should be accepted after the pending request completes",
    );
  });
}
