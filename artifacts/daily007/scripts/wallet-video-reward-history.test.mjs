import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  walletTransactionAmount,
  walletTransactionDescription,
} from '../src/lib/wallet-transaction-display.ts';
import { completeDaily007VideoWatch } from '../../api-server/src/lib/daily007-video-rewards.ts';
import ts from 'typescript';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);
const walletSourceFile = ts.createSourceFile(
  'Wallet.tsx',
  walletScreenSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
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

function loadWalletCallback(callback, scope) {
  assert.ok(ts.isArrowFunction(callback), 'Wallet callbacks should use arrow functions.');
  const javascript = ts.transpileModule(
    `const __callback = (${callback.getText(walletSourceFile)});`,
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

function findWalletFocusCallback() {
  let callback = null;

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && node.expression.getText(walletSourceFile) === 'useFocusEffect'
    ) {
      const useCallback = node.arguments[0];
      assert.ok(ts.isCallExpression(useCallback), 'Wallet focus should register a callback.');
      assert.equal(useCallback.expression.getText(walletSourceFile), 'useCallback');
      callback = useCallback.arguments[0];
    }
    ts.forEachChild(node, visit);
  }

  visit(walletSourceFile);
  assert.ok(callback, 'Wallet should refresh when it receives focus.');
  return callback;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createWalletLoadHarness({ Api, refresh, walletUserId = 'wallet-player' }) {
  const state = {
    history: {
      userId: walletUserId,
      items: [],
      transactionCursor: null,
      paymentCursor: null,
    },
  };
  const setterNames = [
    'setError',
    'setLoading',
    'setLoadingMoreHistory',
    'setHistory',
    'setHistoryLoadError',
    'setBalanceLoadError',
    'setHistoryRetryStatus',
    'setPaymentUpi',
    'setPaymentQr',
    'setPaymentNote',
    'setRechargeEnabled',
    'setWithdrawalEnabled',
    'setMinPurchase',
    'setMaxPurchase',
    'setCoinToMoneyRate',
    'setCoinPackages',
    'setMinWithdraw',
    'setMaxWithdraw',
    'setHasPending',
    'setHasPendingWithdraw',
    'setPendingDepositCoins',
    'setTotalDeposited',
    'setTotalWithdrawn',
  ];
  const setters = Object.fromEntries(setterNames.map((name) => [
    name,
    (value) => {
      const stateKey = `${name[3].toLowerCase()}${name.slice(4)}`;
      state[stateKey] = name === 'setHistory' && typeof value === 'function'
        ? value(state[stateKey])
        : value;
    },
  ]));
  const loadDeclaration = findVariableDeclaration(walletSourceFile, 'load');
  assert.ok(ts.isCallExpression(loadDeclaration.initializer));
  assert.equal(loadDeclaration.initializer.expression.getText(walletSourceFile), 'useCallback');
  const loadWallet = loadWalletCallback(loadDeclaration.initializer.arguments[0], {
    activeWalletUserId: { current: walletUserId },
    Api,
    DEFAULT_MIN_WITHDRAW: 100,
    DEFAULT_MAX_WITHDRAW: 5000,
    apiError: (error) => String(error),
    emptyWalletHistoryState: (userId) => ({
      userId,
      items: [],
      transactionCursor: null,
      paymentCursor: null,
    }),
    historyLoadVersion: { current: 0 },
    refresh,
    walletUserId,
    ...setters,
  });
  const refreshHistoryDeclaration = findVariableDeclaration(walletSourceFile, 'refreshHistory');
  assert.ok(ts.isCallExpression(refreshHistoryDeclaration.initializer));
  const focusedLoads = [];
  const trackedLoad = () => {
    const result = loadWallet();
    focusedLoads.push(result);
    return result;
  };
  const refreshHistory = loadWalletCallback(refreshHistoryDeclaration.initializer.arguments[0], {
    load: trackedLoad,
    setHistoryRetryStatus: setters.setHistoryRetryStatus,
  });
  const focusWallet = loadWalletCallback(findWalletFocusCallback(), { refreshHistory });
  const focusAndWait = () => {
    const previousLoadCount = focusedLoads.length;
    focusWallet();
    assert.equal(focusedLoads.length, previousLoadCount + 1, 'Wallet focus should start one refresh.');
    return focusedLoads[previousLoadCount];
  };
  return { state, loadWallet, focusWallet, focusAndWait, setters };
}

test('Wallet keeps simultaneous video rewards as separate rows with their own balances', () => {
  const transactions = [
    {
      id: 'video-reward-ledger-13',
      amount: 1,
      balanceAfter: 13,
      reason: 'video_watch_reward',
    },
    {
      id: 'video-reward-ledger-14',
      amount: 1,
      balanceAfter: 14,
      reason: 'video_watch_reward',
    },
  ];

  assert.deepEqual(
    transactions.map((transaction) => ({
      id: transaction.id,
      description: walletTransactionDescription(transaction),
      amount: walletTransactionAmount(transaction),
      balanceAfter: transaction.balanceAfter,
    })),
    [
      {
        id: 'video-reward-ledger-13',
        description: 'Video watch reward',
        amount: '+1',
        balanceAfter: 13,
      },
      {
        id: 'video-reward-ledger-14',
        description: 'Video watch reward',
        amount: '+1',
        balanceAfter: 14,
      },
    ],
  );

  assert.match(walletScreenSource, /data=\{visibleTxns\}/);
  assert.match(walletScreenSource, /keyExtractor=\{\(t, i\) => String\(t\.id \?\? i\)\}/);
  assert.match(
    walletScreenSource,
    /testID=\{`wallet-transaction-\$\{String\(item\.id \?\? index\)\}`\}/,
  );
  assert.match(walletScreenSource, /<Text style=\{\[s\.txTitle,[^\]]+\]\}>\{description\}<\/Text>/);
  assert.match(walletScreenSource, /Balance after: \{item\.balanceAfter\} coins/);
  assert.match(walletScreenSource, /:\s*amountLabel\s*\}/);
});

test('returning to Wallet after two rewarded video sessions loads both rows and the latest balance', async () => {
  const now = Date.UTC(2026, 9, 15, 12);
  const userId = 'wallet-player';
  const sessions = new Map([
    ['video-session-one', {
      id: 'video-session-one',
      video_id: 'video-one',
      duration_seconds: 100,
      started_at: new Date(now - 70_000),
      completed_at: null,
      reward_ledger_id: null,
    }],
    ['video-session-two', {
      id: 'video-session-two',
      video_id: 'video-two',
      duration_seconds: 100,
      started_at: new Date(now - 70_000),
      completed_at: null,
      reward_ledger_id: null,
    }],
  ]);
  let serverBalance = 11;
  let nextLedgerId = 1;
  const ledger = [];
  const rewardClient = {
    async query(sql, values = []) {
      if (sql.includes('FROM daily007_v2_video_watch_sessions')) {
        const session = sessions.get(values[0]);
        return { rows: session ? [{ ...session }] : [] };
      }
      if (sql.includes('SELECT active FROM daily007_v2_videos')) {
        return { rows: [{ active: true }] };
      }
      if (sql.includes('SELECT wallet_coins FROM daily007_v2_users')) {
        return { rows: [{ wallet_coins: serverBalance }] };
      }
      if (sql.includes('UPDATE daily007_v2_users SET wallet_coins')) {
        serverBalance = values[1];
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO daily007_v2_wallet_ledger')) {
        const row = {
          id: `reward-ledger-${nextLedgerId++}`,
          amount: values[1],
          balanceAfter: values[2],
          reason: 'video_watch_reward',
          createdAt: new Date(now + ledger.length).toISOString(),
        };
        ledger.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (sql.includes('UPDATE daily007_v2_video_watch_sessions')) {
        const session = sessions.get(values[0]);
        session.completed_at = new Date(now);
        session.reward_ledger_id = values[2];
        return { rows: [{ id: values[0] }] };
      }
      assert.fail(`Unexpected video reward query: ${sql}`);
    },
  };

  const firstReward = await completeDaily007VideoWatch(
    rewardClient,
    userId,
    'video-session-one',
    100,
    now,
  );
  const secondReward = await completeDaily007VideoWatch(
    rewardClient,
    userId,
    'video-session-two',
    100,
    now,
  );

  assert.equal(firstReward.rewarded, true);
  assert.equal(secondReward.rewarded, true);
  assert.equal(serverBalance, 13);
  assert.deepEqual(ledger.map(({ amount, balanceAfter }) => ({ amount, balanceAfter })), [
    { amount: 1, balanceAfter: 12 },
    { amount: 1, balanceAfter: 13 },
  ]);

  let walletBalance = 11;
  let balanceFetches = 0;
  const refresh = async () => {
    balanceFetches += 1;
    walletBalance = serverBalance;
    return { coins: serverBalance };
  };
  const Api = {
    transactionsPage: async () => ({
      items: [...ledger].reverse(),
      nextCursor: null,
    }),
    myPaymentsPage: async () => ({ items: [], nextCursor: null }),
    myWithdrawals: async () => [],
    settings: async () => ({ settings: {} }),
  };
  const { state, focusAndWait } = createWalletLoadHarness({ Api, refresh });

  await focusAndWait();

  assert.equal(balanceFetches, 1, 'Wallet focus should refresh the server-owned balance.');
  assert.equal(walletBalance, 13);
  assert.equal(state.error, '', `Wallet should finish loading without an error: ${state.error}`);
  assert.ok(Array.isArray(state.history?.items), 'Wallet should replace its history after the focus refresh.');
  assert.equal(state.history.items.length, 2);
  assert.deepEqual(
    state.history.items.map((transaction) => ({
      description: walletTransactionDescription(transaction),
      amount: walletTransactionAmount(transaction),
      balanceAfter: transaction.balanceAfter,
    })),
    [
      { description: 'Video watch reward', amount: '+1', balanceAfter: 13 },
      { description: 'Video watch reward', amount: '+1', balanceAfter: 12 },
    ],
  );
  assert.match(walletScreenSource, /AVAILABLE COINS/);
  assert.match(walletScreenSource, /formatWalletCoins\(user\?\.coins/);
});

test('a slower older Wallet load cannot replace the newer balance or video reward history', async () => {
  const olderTransactionPage = createDeferred();
  const oldReward = {
    id: 'video-reward-old',
    amount: 1,
    balanceAfter: 12,
    reason: 'video_watch_reward',
    createdAt: '2026-10-18T12:00:00.000Z',
  };
  const newReward = {
    id: 'video-reward-new',
    amount: 1,
    balanceAfter: 13,
    reason: 'video_watch_reward',
    createdAt: '2026-10-19T12:00:00.000Z',
  };
  let walletBalance = 11;
  let refreshCalls = 0;
  let transactionPageCalls = 0;
  const refresh = async () => {
    const coins = refreshCalls++ === 0 ? 12 : 13;
    walletBalance = coins;
    return { coins };
  };
  const Api = {
    transactionsPage: () => {
      transactionPageCalls += 1;
      return transactionPageCalls === 1
        ? olderTransactionPage.promise
        : Promise.resolve({ items: [newReward], nextCursor: null });
    },
    myPaymentsPage: async () => ({ items: [], nextCursor: null }),
    myWithdrawals: async () => [],
    settings: async () => ({ settings: {} }),
  };
  const { state, loadWallet } = createWalletLoadHarness({ Api, refresh });

  const olderLoad = loadWallet();
  await Promise.resolve();
  assert.equal(walletBalance, 12, 'the older focus request may fetch its balance before its history');

  const newerLoad = loadWallet();
  await newerLoad;
  assert.equal(walletBalance, 13);
  assert.deepEqual(
    state.history.items.map((transaction) => transaction.id),
    [newReward.id],
    'the newest transaction page should include the video reward',
  );
  const newestHistory = state.history;

  olderTransactionPage.resolve({ items: [oldReward], nextCursor: null });
  const olderResult = await olderLoad;

  assert.equal(olderResult, null, 'an out-of-date Wallet load should be ignored');
  assert.equal(walletBalance, 13, 'a late older history response must not replace the latest balance');
  assert.strictEqual(state.history, newestHistory);
  assert.deepEqual(state.history.items.map((transaction) => transaction.id), [newReward.id]);
  assert.equal(state.history.items[0]?.balanceAfter, 13);
});

test('Wallet labels a stale balance when refresh fails and replaces it after a successful focus refresh', async () => {
  const previousReward = {
    id: 'video-reward-previous',
    amount: 1,
    balanceAfter: 20,
    reason: 'video_watch_reward',
    createdAt: '2026-10-17T12:00:00.000Z',
  };
  let currentRewards = [
    {
      id: 'video-reward-current-1',
      amount: 1,
      balanceAfter: 30,
      reason: 'video_watch_reward',
      createdAt: '2026-10-18T12:00:00.000Z',
    },
    {
      id: 'video-reward-current-2',
      amount: 1,
      balanceAfter: 31,
      reason: 'video_watch_reward',
      createdAt: '2026-10-19T12:00:00.000Z',
    },
  ];
  let displayedBalance = 20;
  let serverBalance = 31;
  let failBalanceRefresh = true;
  const refresh = async () => {
    if (failBalanceRefresh) {
      failBalanceRefresh = false;
      throw new Error('balance endpoint unavailable');
    }
    displayedBalance = serverBalance;
    return { coins: serverBalance };
  };
  const Api = {
    transactionsPage: async () => ({ items: currentRewards, nextCursor: null }),
    myPaymentsPage: async () => ({ items: [], nextCursor: null }),
    myWithdrawals: async () => [],
    settings: async () => ({ settings: {} }),
  };
  const { state, focusAndWait, setters } = createWalletLoadHarness({ Api, refresh });
  setters.setHistory({
    userId: 'wallet-player',
    items: [previousReward],
    transactionCursor: 'old-transaction-cursor',
    paymentCursor: null,
  });

  const partialResult = await focusAndWait();

  assert.equal(partialResult, true, 'available transaction history should still load when balance refresh fails');
  assert.equal(displayedBalance, 20, 'the last known balance remains until the server refresh succeeds');
  assert.match(state.balanceLoadError, /Could not refresh your available coin balance/);
  assert.match(state.balanceLoadError, /Showing the last known balance/);
  assert.equal(state.historyLoadError, '');
  assert.deepEqual(state.history.items.map((item) => item.id), currentRewards.map((item) => item.id));

  serverBalance = 34;
  currentRewards = [
    ...currentRewards,
    {
      id: 'video-reward-current-3',
      amount: 1,
      balanceAfter: 34,
      reason: 'video_watch_reward',
      createdAt: '2026-10-20T12:00:00.000Z',
    },
  ];
  await focusAndWait();

  assert.equal(displayedBalance, 34);
  assert.equal(state.balanceLoadError, '');
  assert.equal(state.historyLoadError, '');
  assert.deepEqual(state.history.items.map((item) => item.id), currentRewards.map((item) => item.id));
  assert.equal(state.loading, false);
  assert.match(walletScreenSource, /testID="wallet-balance-error"/);
  assert.match(walletScreenSource, /testID="wallet-balance-retry"/);
});

test('Wallet labels retained transactions when history fails and replaces them after a successful focus refresh', async () => {
  const previousReward = {
    id: 'video-reward-previous',
    amount: 1,
    balanceAfter: 40,
    reason: 'video_watch_reward',
    createdAt: '2026-10-17T12:00:00.000Z',
  };
  const currentRewards = [
    {
      id: 'video-reward-current-1',
      amount: 1,
      balanceAfter: 51,
      reason: 'video_watch_reward',
      createdAt: '2026-10-18T12:00:00.000Z',
    },
    {
      id: 'video-reward-current-2',
      amount: 1,
      balanceAfter: 52,
      reason: 'video_watch_reward',
      createdAt: '2026-10-19T12:00:00.000Z',
    },
  ];
  let displayedBalance = 40;
  let serverBalance = 51;
  let failTransactionHistory = true;
  const refresh = async () => {
    displayedBalance = serverBalance;
    return { coins: serverBalance };
  };
  const Api = {
    transactionsPage: async () => {
      if (failTransactionHistory) {
        failTransactionHistory = false;
        throw new Error('transaction history unavailable');
      }
      return { items: currentRewards, nextCursor: null };
    },
    myPaymentsPage: async () => ({ items: [], nextCursor: null }),
    myWithdrawals: async () => [],
    settings: async () => ({ settings: {} }),
  };
  const { state, focusAndWait, setters } = createWalletLoadHarness({ Api, refresh });
  setters.setHistory({
    userId: 'wallet-player',
    items: [previousReward],
    transactionCursor: 'old-transaction-cursor',
    paymentCursor: null,
  });

  const partialResult = await focusAndWait();

  assert.equal(partialResult, false, 'a failed transaction-history request should be reported as incomplete');
  assert.equal(displayedBalance, 51, 'a successful balance refresh should still be applied');
  assert.equal(state.balanceLoadError, '');
  assert.match(state.historyLoadError, /Could not refresh transaction history/);
  assert.match(state.historyLoadError, /Previously loaded transactions are still shown/);
  assert.match(state.historyLoadError, /transaction history unavailable/);
  assert.deepEqual(state.history.items.map((item) => item.id), [previousReward.id]);
  assert.equal(state.history.transactionCursor, 'old-transaction-cursor');
  assert.equal(state.loading, false);

  serverBalance = 53;
  await focusAndWait();

  assert.equal(displayedBalance, 53);
  assert.equal(state.balanceLoadError, '');
  assert.equal(state.historyLoadError, '');
  assert.deepEqual(state.history.items.map((item) => item.id), currentRewards.map((item) => item.id));
  assert.equal(state.history.transactionCursor, null);
  assert.equal(state.loading, false);
  assert.match(walletScreenSource, /testID="wallet-history-error"/);
  assert.match(walletScreenSource, /testID="wallet-history-retry"/);
});
