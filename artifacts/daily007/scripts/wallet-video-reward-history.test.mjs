import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  walletTransactionAmount,
  walletTransactionDescription,
} from '../src/lib/wallet-transaction-display.ts';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);

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
