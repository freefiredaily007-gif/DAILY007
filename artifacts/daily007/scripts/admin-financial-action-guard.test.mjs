import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const helperSource = await readFile(new URL('../src/lib/inFlightAction.ts', import.meta.url), 'utf8');
const paymentsSource = await readFile(new URL('../src/screens/AdminPayments.tsx', import.meta.url), 'utf8');
const walletSource = await readFile(new URL('../src/screens/AdminWallet.tsx', import.meta.url), 'utf8');

const helperJs = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { runOnceWhileInFlight } = new Function(
  'exports',
  `${helperJs}\nreturn exports;`,
)({});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('a repeated tap during a pending financial action starts only one request and releases afterward', async () => {
  for (const actionName of ['deposit approval', 'withdrawal refund', 'manual payout', 'wallet add', 'wallet deduct']) {
    const inFlight = new Set();
    const gate = deferred();
    let requests = 0;
    let balanceChanges = 0;
    let statusChanges = 0;
    const action = () => runOnceWhileInFlight(inFlight, 'same-record', async () => {
      requests += 1;
      await gate.promise;
      balanceChanges += actionName === 'deposit approval' || actionName === 'withdrawal refund' ||
        actionName === 'wallet add' || actionName === 'wallet deduct' ? 1 : 0;
      statusChanges += actionName === 'manual payout' ? 1 : 0;
    });

    const firstTap = action();
    const secondTap = action();
    await secondTap;
    assert.equal(requests, 1, `${actionName}: a quick repeat must not start another request`);
    gate.resolve();
    await firstTap;
    assert.equal(balanceChanges + statusChanges, 1, `${actionName}: one tap should apply one change`);
    assert.equal(inFlight.size, 0, `${actionName}: completed requests must release the guard`);
  }
});

test('Admin financial mutations use synchronous per-record in-flight guards', () => {
  assert.match(paymentsSource, /const requestKey = `\$\{kind\}:\$\{id\}`;/);
  assert.match(paymentsSource, /if \(inFlightActions\.has\(requestKey\)\) return;/);
  assert.match(paymentsSource, /runOnceWhileInFlight\(inFlightActions, requestKey/);
  assert.match(paymentsSource, /runOnceWhileInFlight\(inFlightActions, `\$\{target\.kind\}:\$\{target\.id\}`/);
  assert.match(paymentsSource, /runOnceWhileInFlight\(inFlightActions, `withdrawal:\$\{targetId\}`/);
  assert.match(walletSource, /runOnceWhileInFlight\(inFlightActions, `wallet:\$\{userId\}`/);
  assert.match(walletSource, /adjustment\.requestId/);
});
