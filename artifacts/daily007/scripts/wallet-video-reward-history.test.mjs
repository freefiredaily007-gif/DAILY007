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

  assert.match(walletScreenSource, /data=\{txns\}/);
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
        return { rows: [] };
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

  const state = {};
  let finishWalletLoad;
  const walletLoadFinished = new Promise((resolve) => {
    finishWalletLoad = resolve;
  });
  const setterNames = [
    'setError',
    'setLoading',
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
    'setTxns',
  ];
  const setters = Object.fromEntries(setterNames.map((name) => [
    name,
    (value) => {
      const stateKey = `${name[3].toLowerCase()}${name.slice(4)}`;
      state[stateKey] = value;
      if (name === 'setLoading' && value === false) finishWalletLoad();
    },
  ]));
  let walletBalance = 11;
  let transactionsFetches = 0;
  let balanceFetches = 0;
  const refresh = async () => {
    balanceFetches += 1;
    walletBalance = serverBalance;
    return { coins: serverBalance };
  };
  const Api = {
    transactions: async () => {
      transactionsFetches += 1;
      return [...ledger].reverse();
    },
    myPayments: async () => [],
    myWithdrawals: async () => [],
    settings: async () => ({ settings: {} }),
  };
  const loadDeclaration = findVariableDeclaration(walletSourceFile, 'load');
  assert.ok(ts.isCallExpression(loadDeclaration.initializer));
  assert.equal(loadDeclaration.initializer.expression.getText(walletSourceFile), 'useCallback');
  const loadWallet = loadWalletCallback(loadDeclaration.initializer.arguments[0], {
    Api,
    DEFAULT_MIN_WITHDRAW: 100,
    DEFAULT_MAX_WITHDRAW: 5000,
    apiError: (error) => String(error),
    refresh,
    ...setters,
  });
  const focusWallet = loadWalletCallback(findWalletFocusCallback(), { load: loadWallet });

  await focusWallet();
  await walletLoadFinished;

  assert.equal(balanceFetches, 1, 'Wallet focus should refresh the server-owned balance.');
  assert.equal(transactionsFetches, 1, 'Wallet focus should request transaction history.');
  assert.equal(walletBalance, 13);
  assert.equal(state.error, '', `Wallet should finish loading without an error: ${state.error}`);
  assert.ok(Array.isArray(state.txns), 'Wallet should replace its history after the focus refresh.');
  assert.equal(state.txns.length, 2);
  assert.deepEqual(
    state.txns.map((transaction) => ({
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
