import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { emptyWalletHistoryState, walletHistoryForUser } from '../src/lib/wallet-history-state.ts';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);
const apiSource = await readFile(
  new URL('../src/lib/api.ts', import.meta.url),
  'utf8',
);
const walletRouteSource = await readFile(
  new URL('../../api-server/src/routes/daily007-compat-extra.ts', import.meta.url),
  'utf8',
);

test('Wallet hides the previous account history immediately after a player switch or sign-out', () => {
  const playerAHistory = {
    userId: 'player-a',
    items: [{ id: 'player-a-transaction' }],
    cursor: 'player-a-cursor',
  };

  assert.deepEqual(walletHistoryForUser(playerAHistory, 'player-b'), {
    userId: 'player-b',
    items: [],
    cursor: null,
  });
  assert.deepEqual(walletHistoryForUser(playerAHistory, null), {
    userId: null,
    items: [],
    cursor: null,
  });
  const playerBHistory = {
    ...walletHistoryForUser(playerAHistory, 'player-b'),
    items: [{ id: 'player-b-transaction' }],
  };
  assert.deepEqual(walletHistoryForUser(playerBHistory, 'player-b'), playerBHistory);
  assert.deepEqual(emptyWalletHistoryState('player-b'), {
    userId: 'player-b',
    items: [],
    cursor: null,
  });
});

test('Wallet displays only history owned by the current player and rejects stale request results', () => {
  assert.match(walletScreenSource, /const currentUserHistory = walletHistoryForUser\(history, walletUserId\)/);
  assert.match(walletScreenSource, /const txns = currentUserHistory\.items/);
  assert.match(walletScreenSource, /activeWalletUserId\.current = walletUserId/);
  assert.match(walletScreenSource, /activeWalletUserId\.current === requestedUserId/);
  assert.match(walletScreenSource, /if \(!requestIsCurrent\(\)\) return/);
  assert.match(walletScreenSource, /setHistory\(\{ userId: requestedUserId, items: merged, cursor: nextCursor \}\)/);
  assert.match(
    walletScreenSource,
    /const ownedHistory = walletHistoryForUser\(previous, requestedUserId\)/,
  );
});

test('Wallet transaction requests use the authenticated endpoint without accepting a player ID', () => {
  assert.match(apiSource, /transactions: \(\) => unwrap\(http\.get\('\/wallet\/transactions'\)\)/);
  assert.doesNotMatch(apiSource, /transactions:\s*\([^)]*userId/);
  assert.match(
    walletRouteSource,
    /router\.get\("\/wallet\/transactions", authenticate, async \(req, res\)[\s\S]*?const id = privateAccount\(req, res\)/,
  );
  assert.match(walletRouteSource, /WHERE ledger\.user_id = \$1[\s\S]*?LIMIT 500`, \[id\]/);
});
