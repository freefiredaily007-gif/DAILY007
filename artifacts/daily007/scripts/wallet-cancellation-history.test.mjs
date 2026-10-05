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

test('Wallet displays the tournament name, refund reason, and exact signed amount', () => {
  const entry = {
    amount: 27,
    reason: 'tournament_cancel_refund',
    description: 'Entry fee refunded — Legacy Clash Cup (tournament cancelled)',
  };

  const displayedDescription = walletTransactionDescription(entry);
  assert.match(displayedDescription, /Legacy Clash Cup/);
  assert.match(displayedDescription, /Entry fee refunded/);
  assert.match(displayedDescription, /tournament cancelled/);
  assert.equal(walletTransactionAmount(entry), '+27');
  assert.match(walletScreenSource, /walletTransactionDescription\(item\)/);
  assert.match(walletScreenSource, /walletTransactionAmount\(item\)/);
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
    walletTransactionDescription({ amount: 19, reason: 'tournament_cancel_refund' }),
    'Entry fee refunded (tournament cancelled)',
  );
});