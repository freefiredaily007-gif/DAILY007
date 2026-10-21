import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getTournamentSeatLayout } from '../src/lib/tournamentSeatLayout.ts';
import {
  getTournamentSeatRefreshInterval,
  TOURNAMENT_SEAT_REFRESH_INTERVAL_MS,
} from '../src/lib/tournamentSeatRefresh.ts';

const modeSeatSlotsSource = readFileSync(
  new URL('../src/components/ModeSeatSlotsPanel.tsx', import.meta.url),
  'utf8',
);
const tournamentDetailSource = readFileSync(
  new URL('../src/screens/TDetail.tsx', import.meta.url),
  'utf8',
);

test('Battle Royale formats use their exact team and player capacities', () => {
  assert.deepEqual(
    getTournamentSeatLayout({ gameMode: 'battle_royale', teamType: 'squad' }),
    {
      gameMode: 'battle_royale',
      teamType: 'squad',
      groupCount: 12,
      slotsPerGroup: 4,
      groupKind: 'team',
      directDuel: false,
      individualSquad: true,
    },
  );
  assert.equal(
    getTournamentSeatLayout({ gameMode: 'Battle Royale', teamType: 'duo' })?.groupCount,
    24,
  );
  assert.equal(
    getTournamentSeatLayout({ gameMode: 'Battle Royale', teamType: 'duo' })?.slotsPerGroup,
    2,
  );
  assert.equal(
    getTournamentSeatLayout({ gameMode: 'Battle Royale', teamType: 'solo' })?.groupCount,
    48,
  );
  assert.equal(
    getTournamentSeatLayout({ mode: 'solo', teamType: 'solo' })?.groupKind,
    'player',
  );
});

test('Clash Squad and Lone Wolf use two sides with exact slot counts', () => {
  for (const gameMode of ['clash_squad', 'lone_wolf']) {
    const solo = getTournamentSeatLayout({ gameMode, teamType: 'solo' });
    assert.equal(solo?.groupCount, 2);
    assert.equal(solo?.slotsPerGroup, 1);
    assert.equal(solo?.groupKind, 'player');
    assert.equal(solo?.directDuel, true);
    assert.equal(solo?.individualSquad, false);

    const duo = getTournamentSeatLayout({ gameMode, teamType: 'duo' });
    assert.equal(duo?.groupCount, 2);
    assert.equal(duo?.slotsPerGroup, 2);
    assert.equal(duo?.groupKind, 'team');
    assert.equal(duo?.directDuel, false);

    const squad = getTournamentSeatLayout({ gameMode, teamType: 'squad' });
    assert.equal(squad?.groupCount, 2);
    assert.equal(squad?.slotsPerGroup, 4);
    assert.equal(squad?.groupKind, 'team');
  }
});

test('unknown tournament formats do not get a slot layout', () => {
  assert.equal(getTournamentSeatLayout({ gameMode: 'custom', teamType: 'solo' }), null);
  assert.equal(getTournamentSeatLayout({ gameMode: 'clash_squad', teamType: 'unknown' }), null);
});

test('seat availability refreshes while open details are focused and pauses otherwise', () => {
  assert.equal(
    getTournamentSeatRefreshInterval(true, true, 'open'),
    TOURNAMENT_SEAT_REFRESH_INTERVAL_MS,
  );
  assert.equal(getTournamentSeatRefreshInterval(false, true, 'open'), false);
  assert.equal(getTournamentSeatRefreshInterval(true, false, 'open'), false);
  for (const status of ['ongoing', 'full', 'completed', 'cancelled', 'setup_needed']) {
    assert.equal(getTournamentSeatRefreshInterval(true, true, status), false);
  }
});

test('returning from registration refreshes tournament seat availability immediately', () => {
  assert.match(
    tournamentDetailSource,
    /const shouldRefreshParticipants = participantsScreenHasBlurredRef\.current;[\s\S]*?if \(shouldRefreshParticipants\) void participantsQuery\.refetch\(\)/,
  );
});

test('mode seat cards preserve the Squad palette and show the Join action under the selected slot', () => {
  assert.match(modeSeatSlotsSource, /OPEN • SELECT/);
  assert.match(modeSeatSlotsSource, /borderColor: '#2ecc71'/);
  assert.match(modeSeatSlotsSource, /backgroundColor: 'rgba\(46, 204, 113, 0\.12\)'/);
  assert.match(modeSeatSlotsSource, /color: '#2ecc71'/);
  assert.match(modeSeatSlotsSource, /borderColor: '#e74c3c'/);
  assert.match(modeSeatSlotsSource, /backgroundColor: 'rgba\(231, 76, 60, 0\.14\)'/);
  assert.match(modeSeatSlotsSource, /color: '#e74c3c'/);
  assert.match(modeSeatSlotsSource, /participant\?\.players\?\.\[slotIndex\]/);
  assert.match(modeSeatSlotsSource, /layout\.groupKind === 'player'/);
  assert.match(modeSeatSlotsSource, /layout\.directDuel/);
  assert.match(modeSeatSlotsSource, /mode-seat-duel-row/);
  assert.match(
    modeSeatSlotsSource,
    /const selected = !occupied &&[\s\S]*?selectedSeat\?\.groupNumber === groupNumber &&[\s\S]*?selectedSeat\.slotIndex === slotIndex;/,
  );
  assert.match(modeSeatSlotsSource, /styles\.slotActionArea/);
  assert.match(
    modeSeatSlotsSource,
    /style=\{\[\s*styles\.inlineJoinButton,\s*compactLargeText && styles\.inlineJoinButtonCompact,\s*\]\}/,
  );
  assert.match(modeSeatSlotsSource, /inlineJoinButtonCompact: \{ minHeight: 62, paddingVertical: 4 \}/);
  assert.match(modeSeatSlotsSource, /testID=\{`mode-seat-join-\$\{groupNumber\}-\$\{slotIndex \+ 1\}`\}/);
  assert.match(modeSeatSlotsSource, /onPress=\{\(\) => onJoinSlot\(groupNumber, slotIndex \+ 1\)\}/);
  assert.doesNotMatch(modeSeatSlotsSource, /selectedGroupNumber/);
  assert.match(modeSeatSlotsSource, /TEAM/);
  assert.match(modeSeatSlotsSource, /cursor: !occupied && canSelect \? 'pointer' : 'not-allowed'/);
});
