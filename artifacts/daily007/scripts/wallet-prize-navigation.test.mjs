import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { walletPrizeMatchId } from '../src/lib/wallet-transaction-display.ts';

const walletScreenSource = await readFile(
  new URL('../src/screens/Wallet.tsx', import.meta.url),
  'utf8',
);

test('only match-prize transactions with a saved match ID can open a result', () => {
  assert.equal(walletPrizeMatchId({ reason: 'match_prize', matchId: ' match-123 ' }), 'match-123');
  assert.equal(walletPrizeMatchId({ reason: 'match_prize', matchId: '' }), null);
  assert.equal(walletPrizeMatchId({ reason: 'match_prize', matchId: null }), null);
  assert.equal(walletPrizeMatchId({ reason: 'video_watch_reward', matchId: 'match-123' }), null);
  assert.equal(walletPrizeMatchId({ reason: 'payment_approved', matchId: 'match-123' }), null);
});

test('a prize result opens from the Wallet tab stack and non-prize entries have no press wrapper', () => {
  assert.match(walletScreenSource, /const prizeMatchId = walletPrizeMatchId\(item\)/);
  assert.match(walletScreenSource, /return prizeMatchId \? \(/);
  assert.match(walletScreenSource, /navigation\.getParent\(\)\.push\('TDetail', \{ id: prizeMatchId \}\)/);
  assert.match(walletScreenSource, /testID=\{`wallet-prize-result-\$\{String\(item\.id \?\? index\)\}`\}/);
});
