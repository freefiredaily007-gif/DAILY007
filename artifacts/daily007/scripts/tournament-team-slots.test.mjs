import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getTournamentTeamSlotSummary } from '../src/lib/tournamentTeamSlots.ts';

test('captain-only API summary shows one filled team and eleven available slots', () => {
  const summary = getTournamentTeamSlotSummary({
    filledSlots: 1,
    totalSlots: 12,
    availableSlots: 11,
  });

  assert.deepEqual(summary, {
    filled: 1,
    total: 12,
    available: 11,
    label: '1/12 teams formed · 11 team slots available',
  });
});

test('older tournament responses derive available team slots without dropping the captain team', () => {
  const summary = getTournamentTeamSlotSummary({
    filledSlots: 1,
    totalSlots: 12,
  });

  assert.equal(summary.filled, 1);
  assert.equal(summary.available, 11);
  assert.equal(summary.label, '1/12 teams formed · 11 team slots available');
});

test('Home displays player capacity while tournament details retain the API team-slot summary', async () => {
  const [homeSource, detailSource, apiSource] = await Promise.all([
    readFile(new URL('../src/screens/Home.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/screens/TDetail.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(apiSource, /filledSlots\?: number;[\s\S]*availableSlots\?: number;/);
  assert.match(
    homeSource,
    /const capacity = getHomeTournamentPlayerCapacity\(t\)/,
  );
  assert.match(
    homeSource,
    /testID=\{`home-upcoming-player-capacity-\$\{t\.id\}`\}[\s\S]*?filled\}\/\{total\}/,
  );
  assert.match(
    homeSource,
    /testID=\{`home-upcoming-player-progress-\$\{t\.id\}`\}/,
  );
  assert.match(detailSource, /const teamSlotSummary = getTournamentTeamSlotSummary\(t\)/);
  assert.match(detailSource, /testID=\{individualSquad \? 'tournament-team-slot-count' : undefined\}/);
  assert.match(detailSource, /\? teamSlotSummary\.label/);
});
