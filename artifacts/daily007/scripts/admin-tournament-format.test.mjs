import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  getAdminTournamentCapacity,
  getAdminTournamentFormatOptions,
  getAdminTournamentTitle,
} from '../src/lib/adminTournamentForm.ts';
import { resolveTournamentMode } from '../../api-server/src/lib/daily007-mode-rules.ts';

const screenSource = await readFile(
  new URL('../src/screens/AdminTournaments.tsx', import.meta.url),
  'utf8',
);

test('format options use mode-specific labels while retaining the same saved format values', () => {
  assert.deepEqual(
    getAdminTournamentFormatOptions('Battle Royale'),
    [
      { value: 'Solo', label: 'Solo' },
      { value: 'Duo', label: 'Duo' },
      { value: 'Squad', label: 'Squad' },
    ],
  );
  assert.deepEqual(
    getAdminTournamentFormatOptions('Battle Royale Kill & Earn'),
    [
      { value: 'Solo', label: 'Solo' },
      { value: 'Duo', label: 'Duo' },
      { value: 'Squad', label: 'Squad' },
    ],
  );
  for (const mode of ['Clash Squad', 'Lone Wolf']) {
    assert.deepEqual(
      getAdminTournamentFormatOptions(mode),
      [
        { value: 'Solo', label: '1 VS 1' },
        { value: 'Duo', label: '2 VS 2' },
        { value: 'Trio', label: '3 VS 3' },
        { value: 'Squad', label: '4 VS 4' },
      ],
    );
  }
});

test('generated tournament titles combine the selected game mode and displayed format', () => {
  assert.equal(getAdminTournamentTitle('Battle Royale', 'Solo'), 'Battle Royale Solo');
  assert.equal(getAdminTournamentTitle('Battle Royale', 'Duo'), 'Battle Royale Duo');
  assert.equal(getAdminTournamentTitle('Battle Royale Kill & Earn', 'Solo'), 'Battle Royale Kill & Earn Solo');
  assert.equal(getAdminTournamentTitle('Battle Royale Kill & Earn', 'Duo'), 'Battle Royale Kill & Earn Duo');
  assert.equal(getAdminTournamentTitle('Battle Royale Kill & Earn', 'Squad'), 'Battle Royale Kill & Earn Squad');
  assert.equal(getAdminTournamentTitle('Clash Squad', 'Solo'), 'Clash Squad 1 VS 1');
  assert.equal(getAdminTournamentTitle('Clash Squad', 'Trio'), 'Clash Squad 3 VS 3');
  assert.equal(getAdminTournamentTitle('Clash Squad', 'Squad'), 'Clash Squad 4 VS 4');
  assert.equal(getAdminTournamentTitle('Lone Wolf', 'Duo'), 'Lone Wolf 2 VS 2');
  assert.equal(getAdminTournamentTitle('Lone Wolf', 'Trio'), 'Lone Wolf 3 VS 3');
});

test('selected format determines canonical slot and player capacities', () => {
  assert.deepEqual(getAdminTournamentCapacity('Battle Royale', 'Solo'), {
    slots: 48,
    label: '48 player slots',
  });
  assert.deepEqual(getAdminTournamentCapacity('Battle Royale', 'Duo'), {
    slots: 24,
    label: '24 team slots · 48 players',
  });
  assert.deepEqual(getAdminTournamentCapacity('Battle Royale', 'Squad'), {
    slots: 12,
    label: '12 team slots · 48 players',
  });
  assert.deepEqual(getAdminTournamentCapacity('Battle Royale Kill & Earn', 'Solo'), {
    slots: 48,
    label: '48 player slots',
  });
  assert.deepEqual(getAdminTournamentCapacity('Battle Royale Kill & Earn', 'Duo'), {
    slots: 24,
    label: '24 team slots · 48 players',
  });
  assert.deepEqual(getAdminTournamentCapacity('Battle Royale Kill & Earn', 'Squad'), {
    slots: 12,
    label: '12 team slots · 48 players',
  });
  assert.deepEqual(getAdminTournamentCapacity('Clash Squad', 'Solo'), {
    slots: 2,
    label: '2 player slots',
  });
  assert.deepEqual(getAdminTournamentCapacity('Lone Wolf', 'Duo'), {
    slots: 2,
    label: '2 team slots · 4 players',
  });
  assert.deepEqual(getAdminTournamentCapacity('Lone Wolf', 'Trio'), {
    slots: 2,
    label: '2 team slots · 6 players',
  });
  assert.deepEqual(getAdminTournamentCapacity('Clash Squad', 'Squad'), {
    slots: 2,
    label: '2 team slots · 8 players',
  });
});

test('all eight Clash Squad and Lone Wolf admin formats resolve to the correct stored mode and team type', () => {
  for (const [mode, gameMode] of [
    ['Clash Squad', 'clash_squad'],
    ['Lone Wolf', 'lone_wolf'],
  ]) {
    for (const [teamType, size] of [
      ['Solo', 1],
      ['Duo', 2],
      ['Trio', 3],
      ['Squad', 4],
    ]) {
      const resolved = resolveTournamentMode(mode, teamType);
      assert.ok(resolved);
      assert.equal(resolved.gameMode, gameMode);
      assert.equal(resolved.teamType, teamType.toLowerCase());
      assert.equal(resolved.teamSize, size);
      assert.equal(resolved.capacity, 2);
      assert.equal(resolved.storageMode, 'clash');
      assert.equal(getAdminTournamentTitle(mode, teamType).startsWith(mode), true);
    }
  }
});

test('create and edit forms show a read-only title and save its generated value', () => {
  assert.match(screenSource, /testID="admin-tournament-generated-title"/);
  assert.doesNotMatch(screenSource, /Tournament name \*/);
  assert.doesNotMatch(screenSource, /form\.name\.trim\(\)/);
  assert.match(screenSource, /name: getAdminTournamentTitle\(form\.mode, form\.teamType\)/);
  assert.match(screenSource, /mode: form\.mode, teamType: form\.teamType/);
  assert.match(screenSource, /getAdminTournamentFormatOptions\(form\.mode\)\.map/);
  assert.match(screenSource, /totalSlots: capacity\.slots/);
  assert.match(screenSource, /admin-kill-earn-submode-dropdown/);
  assert.match(screenSource, /killRewardCoins/);
});
