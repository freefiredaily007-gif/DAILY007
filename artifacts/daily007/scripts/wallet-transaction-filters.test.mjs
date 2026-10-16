import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { walletTransactionMatchesFilter } from '../src/lib/wallet-transaction-display.ts';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);

test('Wallet transaction filters include the relevant ledger entries and requests', () => {
  const fixtures = [
    { id: 'payment-request', isRequest: true, requestType: 'payment' },
    { id: 'approved-payment', reason: 'payment_approved' },
    { id: 'withdrawal-request', isRequest: true, requestType: 'withdrawal' },
    { id: 'reserved-withdrawal', reason: 'withdrawal_reserved' },
    { id: 'registration-refund', reason: 'registration_refund' },
    { id: 'cancel-refund', reason: 'tournament_cancel_refund' },
    { id: 'rejected-withdrawal-refund', reason: 'withdrawal_rejected_refund' },
    { id: 'deleted-withdrawal-refund', reason: 'withdrawal_deleted_refund' },
    { id: 'video-reward', reason: 'video_watch_reward' },
    { id: 'tournament-entry', reason: 'match_entry' },
  ];

  assert.deepEqual(
    fixtures.filter((item) => walletTransactionMatchesFilter(item, 'deposits')).map(({ id }) => id),
    ['payment-request', 'approved-payment'],
  );
  assert.deepEqual(
    fixtures.filter((item) => walletTransactionMatchesFilter(item, 'withdrawals')).map(({ id }) => id),
    ['withdrawal-request', 'reserved-withdrawal'],
  );
  assert.deepEqual(
    fixtures.filter((item) => walletTransactionMatchesFilter(item, 'refunds')).map(({ id }) => id),
    [
      'registration-refund',
      'cancel-refund',
      'rejected-withdrawal-refund',
      'deleted-withdrawal-refund',
    ],
  );
  assert.deepEqual(
    fixtures.filter((item) => walletTransactionMatchesFilter(item, 'all')),
    fixtures,
  );
});

test('switching filters changes the rendered rows without changing balances or transaction details', () => {
  const approvedDeposit = {
    id: 'deposit-1',
    amount: 25,
    balanceAfter: 125,
    createdAt: '2030-02-03T10:20:00.000Z',
    reason: 'payment_approved',
    description: 'Coin recharge approved',
    details: { paymentId: 'payment-1' },
  };
  const withdrawal = {
    id: 'withdrawal-1',
    amount: -10,
    balanceAfter: 115,
    createdAt: '2030-02-03T10:19:00.000Z',
    reason: 'withdrawal_reserved',
    description: 'Withdrawal request',
  };
  const sourceTransactions = [approvedDeposit, withdrawal];
  const filteredTransactions = sourceTransactions.filter((item) =>
    walletTransactionMatchesFilter(item, 'deposits'));

  assert.deepEqual(filteredTransactions, [approvedDeposit]);
  assert.strictEqual(filteredTransactions[0], approvedDeposit);
  assert.equal(approvedDeposit.balanceAfter, 125);
  assert.deepEqual(approvedDeposit.details, { paymentId: 'payment-1' });
  assert.deepEqual(sourceTransactions, [approvedDeposit, withdrawal]);
  assert.match(walletScreenSource, /const \[historyFilter, setHistoryFilter\] = useState<WalletTransactionFilter>\('all'\)/);
  assert.match(walletScreenSource, /data=\{visibleTxns\}/);
  assert.match(walletScreenSource, /setHistoryFilter\(filter\.value\)/);
  assert.match(walletScreenSource, /AVAILABLE COINS/);
  assert.match(walletScreenSource, /formatWalletCoins\(user\?\.coins/);
  assert.match(walletScreenSource, /testID="wallet-history-empty-state"/);
  assert.match(walletScreenSource, /accessibilityLiveRegion="polite"/);
  assert.match(walletScreenSource, /accessibilityState=\{\{ selected: active \}\}/);
});

test('All remains the default view and the existing newest-first sort is preserved', () => {
  assert.match(walletScreenSource, /value: 'all', label: 'All'/);
  assert.match(walletScreenSource, /const \[historyFilter, setHistoryFilter\] = useState<WalletTransactionFilter>\('all'\)/);
  assert.match(
    walletScreenSource,
    /\.sort\(\(left, right\) => Date\.parse\(String\(right\.createdAt \?\? ''\)\) - Date\.parse\(String\(left\.createdAt \?\? ''\)\)\)/,
  );
});
