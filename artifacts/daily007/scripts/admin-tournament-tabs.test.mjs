import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { filterAdminTournamentsByTab } from '../src/lib/adminTournamentTabs.ts';

const now = Date.parse('2026-10-22T12:00:00.000Z');
const tournaments = [
  { id: 'upcoming', startsAt: '2026-10-23T12:00:00.000Z', status: 'open', enabled: true },
  { id: 'ongoing', startsAt: '2026-10-22T11:00:00.000Z', status: 'full', enabled: true },
  { id: 'completed', startsAt: '2026-10-22T10:00:00.000Z', status: 'completed', enabled: false },
  { id: 'cancelled', startsAt: '2026-10-22T09:00:00.000Z', status: 'cancelled', enabled: false },
];

test('Admin tournament tabs retain the normal lifecycle buckets and expose cancelled history separately', () => {
  assert.deepEqual(filterAdminTournamentsByTab(tournaments, 'upcoming', now).map(({ id }) => id), ['upcoming']);
  assert.deepEqual(filterAdminTournamentsByTab(tournaments, 'ongoing', now).map(({ id }) => id), ['ongoing']);
  assert.deepEqual(filterAdminTournamentsByTab(tournaments, 'completed', now).map(({ id }) => id), ['completed']);
  assert.deepEqual(filterAdminTournamentsByTab(tournaments, 'cancelled', now).map(({ id }) => id), ['cancelled']);
});

test('cancelled Admin history is visible without exposing result or payout actions', async () => {
  const source = await readFile(path.resolve(process.cwd(), 'src/screens/AdminTournaments.tsx'), 'utf8');
  assert.match(source, /\{ id: 'cancelled', label: 'Cancelled' \}/);
  assert.match(source, /filterAdminTournamentsByTab\(list \?\? \[\], tab, clockNow\)/);
  assert.match(source, /cancelled \? 'CANCELLED'/);
  assert.match(source, /\{tab === 'ongoing' && \([\s\S]*?RESULT ENTRY/);
  assert.match(source, /\{tab === 'completed' && \([\s\S]*?WINNER & RESULT LOG/);
});
