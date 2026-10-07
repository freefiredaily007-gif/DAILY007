import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  walletTransactionAccessibilityLabel,
  walletTransactionAmount,
  walletTransactionDescription,
} from '../src/lib/wallet-transaction-display.ts';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);
const refundRowSource = await readFile(
  new URL('../src/components/WalletCancellationRefundRow.tsx', import.meta.url),
  'utf8',
);
const nativeTestSource = await readFile(
  new URL('../src/screens/WalletCancellationRefundNativeTest.tsx', import.meta.url),
  'utf8',
);
const maestroFlow = await readFile(
  new URL('../maestro/wallet-cancellation-refund/accessibility-label.yaml', import.meta.url),
  'utf8',
);
const packageSource = JSON.parse(await readFile(
  new URL('../package.json', import.meta.url),
  'utf8',
));

test('Wallet displays the tournament name, refund reason, and exact signed amount', () => {
  const entry = {
    amount: 27,
    balanceAfter: 155,
    createdAt: '2030-02-03T10:20:00.000Z',
    reason: 'tournament_cancel_refund',
    description: 'Entry fee refunded — Legacy Clash Cup (tournament cancelled)',
  };

  const displayedDescription = walletTransactionDescription(entry);
  assert.match(displayedDescription, /Legacy Clash Cup/);
  assert.match(displayedDescription, /Entry fee refunded/);
  assert.match(displayedDescription, /tournament cancelled/);
  assert.equal(walletTransactionAmount(entry), '+27');
  assert.equal(
    walletTransactionAccessibilityLabel(entry),
    'Entry fee refunded — Legacy Clash Cup (tournament cancelled). +27 coins credited. Date: 2030-02-03 10:20. Balance after: 155 coins.',
  );
  assert.match(
    walletScreenSource,
    /if \(isCancellationRefund\)\s*\{\s*return <WalletCancellationRefundRow item=\{item\} \/>;/,
  );
  assert.match(refundRowSource, /<Card\s+accessible\s+accessibilityRole="text"/);
  assert.match(
    refundRowSource,
    /accessibilityLabel=\{walletTransactionAccessibilityLabel\(item\)\}/,
  );
  assert.match(refundRowSource, /testID="wallet-cancellation-refund-row"/);
});

test('Wallet displays the ID fallback and keeps a reason label when the API has no description', () => {
  const missingTournamentId = '00000000-0000-4000-8000-000000000082';
  const fallbackEntry = {
    amount: 19,
    reason: 'tournament_cancel_refund',
    description: `Entry fee refunded — tournament ${missingTournamentId} (tournament cancelled)`,
  };
  assert.equal(walletTransactionDescription(fallbackEntry), fallbackEntry.description);
  assert.equal(walletTransactionAmount(fallbackEntry), '+19');
  assert.equal(
    walletTransactionAccessibilityLabel(fallbackEntry),
    `${fallbackEntry.description}. +19 coins credited.`,
  );

  assert.equal(
    walletTransactionDescription({ amount: 19, reason: 'tournament_cancel_refund' }),
    'Entry fee refunded (tournament cancelled)',
  );
});

test('Android exposes the production cancellation-refund row as one complete accessibility item', () => {
  assert.match(nativeTestSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(nativeTestSource, /Legacy Clash Cup/);
  assert.match(nativeTestSource, /tournament cancelled/);
  assert.match(nativeTestSource, /amount: 27/);
  assert.match(nativeTestSource, /2030-02-03T10:20:00\.000Z/);
  assert.match(nativeTestSource, /balanceAfter: 155/);
  assert.match(nativeTestSource, /eachDetailAppearsOnce/);
  assert.doesNotMatch(nativeTestSource, /\bApi\.|\bfetch\s*\(/);

  assert.match(maestroFlow, /wallet-cancellation-refund-test/);
  assert.match(maestroFlow, /id: wallet-cancellation-refund-row/);
  assert.match(
    maestroFlow,
    /Entry fee refunded — Legacy Clash Cup \(tournament cancelled\)\. \+27 coins credited\. Date: 2030-02-03 10:20\. Balance after: 155 coins\./,
  );
  assert.equal(
    packageSource.scripts['test:android-wallet-cancellation-refund'],
    'maestro test maestro/wallet-cancellation-refund',
  );
});
