import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const walletSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);
const walletSourceFile = ts.createSourceFile(
  'Wallet.tsx',
  walletSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function findVariableDeclaration(name) {
  let declaration = null;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(walletSourceFile);
  assert.ok(declaration, `Expected a ${name} declaration in Wallet.tsx.`);
  return declaration;
}

function compile(source, scope) {
  const javascript = ts.transpileModule(`const __value = (${source});`, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __value;`,
  )(...Object.values(scope));
}

function createLoadMoreHistory(state, Api) {
  const declaration = findVariableDeclaration('loadMoreHistory');
  assert.ok(ts.isCallExpression(declaration.initializer));
  assert.equal(declaration.initializer.expression.getText(walletSourceFile), 'useCallback');
  const callback = declaration.initializer.arguments[0];
  assert.ok(ts.isArrowFunction(callback));
  return compile(callback.getText(walletSourceFile), {
    transactionHistoryCursor: state.transactionCursor,
    paymentHistoryCursor: state.paymentCursor,
    walletUserId: state.userId,
    loadingMoreHistory: state.loadingMoreHistory,
    historyLoadVersion: { current: 1 },
    activeWalletUserId: { current: state.userId },
    setLoadingMoreHistory: (value) => { state.loadingMoreHistory = value; },
    setError: (value) => { state.error = value; },
    historyApi: Api,
    apiError: (error) => error?.message ?? String(error),
    walletHistoryForUser: (history, userId) => history.userId === userId
      ? history
      : { userId, items: [], transactionCursor: null, paymentCursor: null },
    setHistory: (update) => {
      state.history = typeof update === 'function' ? update(state.history) : update;
      state.transactionCursor = state.history.transactionCursor;
      state.paymentCursor = state.history.paymentCursor;
    },
  });
}

test('failed older-payment page keeps history and can retry the same cursor once', async () => {
  const existingPayment = {
    id: 'pay-existing',
    description: 'Coin recharge request',
    createdAt: '2026-10-19T10:00:00.000Z',
    isRequest: true,
    requestType: 'payment',
  };
  const olderPayment = {
    id: 'older',
    txnId: 'OLDER-REFERENCE',
    coins: 50,
    amount: 50,
    status: 'approved',
    createdAt: '2026-10-18T10:00:00.000Z',
  };
  const state = {
    userId: 'wallet-player',
    history: {
      userId: 'wallet-player',
      items: [existingPayment],
      transactionCursor: null,
      paymentCursor: 'payment-cursor-1',
    },
    transactionCursor: null,
    paymentCursor: 'payment-cursor-1',
    loadingMoreHistory: false,
    loading: false,
    error: '',
  };
  const paymentCursors = [];
  let shouldFail = true;
  const Api = {
    transactionsPage: async () => {
      throw new Error('No transaction page should be requested without a cursor.');
    },
    myPaymentsPage: async (cursor) => {
      paymentCursors.push(cursor);
      if (shouldFail) {
        shouldFail = false;
        throw new Error('Temporary network failure.');
      }
      return {
        items: [olderPayment, { ...olderPayment }],
        nextCursor: 'payment-cursor-2',
      };
    },
  };

  const firstAttempt = createLoadMoreHistory(state, Api);
  await firstAttempt();

  assert.deepEqual(paymentCursors, ['payment-cursor-1']);
  assert.deepEqual(state.history.items, [existingPayment], 'the first-page history stays visible after failure.');
  assert.equal(state.history.paymentCursor, 'payment-cursor-1', 'the failed cursor remains available to retry.');
  assert.equal(state.loadingMoreHistory, false, 'the older-history action is no longer in its loading state.');
  assert.equal(state.error, 'Temporary network failure.');
  assert.match(walletSource, /testID="wallet-load-older-transactions"[\s\S]*?disabled=\{loadingMoreHistory \|\| loading\}/);

  const retry = createLoadMoreHistory(state, Api);
  await retry();

  assert.deepEqual(paymentCursors, ['payment-cursor-1', 'payment-cursor-1']);
  assert.deepEqual(
    state.history.items.map((payment) => payment.id),
    ['pay-existing', 'pay-older'],
    'the older request is appended once, without duplicating repeated rows in the response.',
  );
  assert.equal(state.history.paymentCursor, 'payment-cursor-2');
  assert.equal(state.loadingMoreHistory, false);
});
