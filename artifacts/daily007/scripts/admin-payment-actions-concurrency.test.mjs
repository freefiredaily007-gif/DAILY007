import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { runOnceWhileInFlight } from "../src/lib/inFlightAction.ts";

const screenSource = await readFile(
  new URL("../src/screens/AdminPayments.tsx", import.meta.url),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "AdminPayments.tsx",
  screenSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findHandler(handlerName) {
  let declaration = null;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === handlerName
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(declaration?.initializer, `Expected ${handlerName} callback.`);
  assert.ok(
    ts.isArrowFunction(declaration.initializer),
    `${handlerName} should remain a directly testable callback.`,
  );
  return declaration.initializer;
}

function createHandler(handlerName, scope) {
  const callback = findHandler(handlerName);
  const javascript = ts.transpileModule(
    `const __callback = (${callback.getText(sourceFile)});`,
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

function createHarness(rejectKind = "payment") {
  let resolveFirstRequest;
  const calls = [];
  const inFlight = new Set();
  const pendingRequest = new Promise((resolve) => {
    resolveFirstRequest = resolve;
  });
  const callApi = (method) => (...args) => {
    calls.push({ method, args });
    return calls.length === 1
      ? pendingRequest
      : Promise.resolve({ payoutStatus: "paid" });
  };
  const scope = {
    Api: {
      adminPaymentAction: callApi("payment"),
      adminWithdrawalAction: callApi("withdrawal"),
      adminMarkWithdrawalPaid: callApi("payout"),
    },
    all: [{
      id: "withdrawal-1",
      kind: "withdrawal",
      payoutStatus: "manual_payout_required",
      userName: "Player One",
    }],
    apiError: (error) => String(error),
    busyId: null,
    clearOkMsgTimeout: () => {},
    payoutBusy: false,
    payoutTarget: "withdrawal-1",
    rejectBusy: false,
    rejectTarget: { id: "request-1", kind: rejectKind, userName: "Player One" },
    inFlightActions: inFlight,
    requestMutationsInFlight: { current: inFlight },
    runOnceWhileInFlight,
    setAll: (update) => update(scope.all),
    setBusyId: () => {},
    setErr: () => {},
    setOkMsg: () => {},
    setPayoutBusy: () => {},
    setPayoutTarget: () => {},
    setRejectBusy: () => {},
    setRejectTarget: () => {},
    showOkMsg: () => {},
    load: () => Promise.resolve(),
    withdrawalPayoutStatusLabel: (status) => status,
  };

  return {
    calls,
    inFlight,
    resolveFirstRequest: () => resolveFirstRequest({ payoutStatus: "paid" }),
    loadHandler: (handlerName) => createHandler(handlerName, scope),
  };
}

async function assertRepeatIsIgnored(harness, key, submitFirst, submitAgain) {
  const firstRequest = submitFirst();
  assert.equal(harness.calls.length, 1);
  assert.ok(harness.inFlight.has(key));

  await submitAgain();
  assert.equal(
    harness.calls.length,
    1,
    "a fast repeat must not send another request while the first is pending",
  );

  harness.resolveFirstRequest();
  await firstRequest;
  assert.equal(harness.inFlight.has(key), false);

  await submitAgain();
  assert.equal(harness.calls.length, 2, "later, intentional actions remain available");
}

for (const kind of ["payment", "withdrawal"]) {
  test(`AdminPayments ignores a repeated ${kind} approval while it is pending`, async () => {
    const harness = createHarness();
    const act = harness.loadHandler("act");
    const submit = () => act(`${kind}-1`, kind, "approve", "Player One");
    await assertRepeatIsIgnored(harness, `${kind}:${kind}-1`, submit, submit);
    assert.deepEqual(harness.calls.map((call) => call.method), [kind, kind]);
  });

  test(`AdminPayments ignores a repeated ${kind} rejection while it is pending`, async () => {
    const harness = createHarness(kind);
    const reject = harness.loadHandler("reject");
    const submit = () => reject("Duplicate request test reason");
    await assertRepeatIsIgnored(
      harness,
      `${kind}:request-1`,
      submit,
      submit,
    );
    assert.deepEqual(harness.calls.map((call) => call.method), [kind, kind]);
  });
}

test("AdminPayments ignores a repeated manual payout confirmation while it is pending", async () => {
  const harness = createHarness();
  const markPaid = harness.loadHandler("markPaid");
  const submit = () => markPaid();

  await assertRepeatIsIgnored(
    harness,
    "withdrawal:withdrawal-1",
    submit,
    submit,
  );
  assert.deepEqual(harness.calls.map((call) => call.method), ["payout", "payout"]);
});
