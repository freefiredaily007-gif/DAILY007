import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const homeSource = await readFile(
  new URL('../src/screens/Home.tsx', import.meta.url),
  'utf8',
);

test('Home upcoming cards detect Kill & Earn and render the configured per-kill reward', () => {
  assert.match(
    homeSource,
    /function isKillEarnTournament\(t: any\)[\s\S]*?replace\(\/\[\\s&-\]\+\/g, '_'\)[\s\S]*?return gameMode === 'battle_royale_kill_earn'/,
  );
  assert.match(homeSource, /const perKillCoins = Number\(t\.perKillCoins \?\? t\.killRewardCoins \?\? 0\)/);
  assert.match(
    homeSource,
    /\{isKillEarn && \([\s\S]*?testID=\{`home-upcoming-per-kill-\$\{t\.id\}`\}[\s\S]*?PER KILL[\s\S]*?\{perKillCoins\}/,
  );
  assert.match(homeSource, /isKillEarn \? `\$\{perKillCoins\} coins per kill\.` : ''/);
});

test('the additional per-kill metric is conditional and uses compact responsive card styles', () => {
  assert.match(homeSource, /style=\{\[s\.mStats, isKillEarn && s\.mStatsKillEarn\]\}/);
  assert.match(homeSource, /mStatsKillEarn:\s*\{\s*alignItems: 'stretch'\s*\}/);
  assert.match(homeSource, /mStatVKillEarn:\s*\{\s*fontSize: 12/);
  assert.equal((homeSource.match(/PER KILL/g) ?? []).length, 1);
});
