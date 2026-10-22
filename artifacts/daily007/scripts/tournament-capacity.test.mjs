import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { isTournamentCapacityFull } from '../src/lib/tournamentCapacity.ts';

const [detailSource, joinFormSource, modeSlotsSource] = await Promise.all([
  readFile(path.resolve(process.cwd(), 'src/screens/TDetail.tsx'), 'utf8'),
  readFile(path.resolve(process.cwd(), 'src/screens/JoinForm.tsx'), 'utf8'),
  readFile(path.resolve(process.cwd(), 'src/components/ModeSeatSlotsPanel.tsx'), 'utf8'),
]);

test('team cards being occupied does not mean the individual player seats are full', () => {
  for (const status of ['open', 'full', 'setup_needed']) {
    assert.equal(isTournamentCapacityFull({
      filledPlayers: 3,
      totalPlayers: 4,
      filledSlots: 2,
      totalSlots: 2,
      status,
    }), false);
  }
});

test('joining closes only after the last player seat is claimed', () => {
  assert.equal(isTournamentCapacityFull({
    filledPlayers: 4,
    totalPlayers: 4,
    filledSlots: 2,
    totalSlots: 2,
    status: 'open',
  }), true);
});

test('single-player tournaments still use their actual player-slot capacity', () => {
  assert.equal(isTournamentCapacityFull({
    filledPlayers: 47,
    totalPlayers: 48,
    filledSlots: 47,
    totalSlots: 48,
    status: 'full',
  }), false);
  assert.equal(isTournamentCapacityFull({
    filledPlayers: 48,
    totalPlayers: 48,
    filledSlots: 48,
    totalSlots: 48,
    status: 'open',
  }), true);
});

test('status remains the fallback only when no player-capacity count is available', () => {
  assert.equal(isTournamentCapacityFull({
    filledPlayers: 0,
    totalPlayers: 0,
    filledSlots: 2,
    totalSlots: 2,
    status: 'setup_needed',
  }), true);
});

test('tournament details, join form, and slot buttons share the corrected capacity gate', () => {
  assert.match(detailSource, /const full = isTournamentCapacityFull\(/);
  assert.match(detailSource, /canSelect=\{[\s\S]*?!full[\s\S]*?onJoinSlot/);
  assert.match(joinFormSource, /const full = isTournamentCapacityFull\(/);
  assert.match(joinFormSource, /const unavailable = full \|\| closed/);
  assert.match(modeSlotsSource, /disabled: occupied \|\| !canSelect/);
});
