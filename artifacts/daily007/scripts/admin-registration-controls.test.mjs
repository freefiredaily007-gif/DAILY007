import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { copyUidToClipboard } from '../src/lib/copyUidToClipboard.ts';
import { filterAdminRegistrationRows } from '../src/lib/adminRegistrationFilter.ts';
import {
  formatAdminRegistrationStart,
  formatAdminRegistrationTime,
  buildAdminRegistrationTournamentCards,
  groupApprovedRegistrationRows,
} from '../src/lib/adminApprovedRegistrationMatches.ts';
import { getTournamentLifecycleState } from '../src/lib/tournamentLifecycle.ts';

const screenSource = await readFile(
  new URL('../src/screens/AdminRegs.tsx', import.meta.url),
  'utf8',
);
const apiRouteSource = await readFile(
  new URL('../../api-server/src/routes/daily007-compat-core.ts', import.meta.url),
  'utf8',
);
const copyButtonSource = await readFile(
  new URL('../src/components/CopyUidButton.tsx', import.meta.url),
  'utf8',
);

test('registration screen removes status tabs, tournament filters, and CSV export sections', () => {
  assert.doesNotMatch(screenSource, /const TABS|admin-registration-filter-/);
  assert.doesNotMatch(screenSource, /TOURNAMENT REGISTRATION LIST|PLAYER LIST EXPORT|DOWNLOAD CSV|DOWNLOAD PLAYER LIST/);
  assert.doesNotMatch(screenSource, /exportCsv|expo-file-system|expo-sharing/);
  assert.match(screenSource, /APPROVED PLAYERS · ACTIVE AND SCHEDULED TOURNAMENTS/);
});

test('tournament cards include active and scheduled matches, including empty approved rosters', () => {
  const now = Date.parse('2026-10-21T12:00:00.000Z');
  const activeTournaments = [
    {
      id: 'future-match',
      name: 'Battle Royale Solo',
      startsAt: '2026-10-21T15:30:00.000Z',
      status: 'open',
      enabled: true,
      totalPlayerSlots: 48,
    },
    {
      id: 'live-match',
      name: 'Clash Squad 1 VS 1',
      startsAt: '2026-10-21T10:00:00.000Z',
      status: 'ongoing',
      enabled: true,
      totalPlayerSlots: 2,
    },
    {
      id: 'completed-match',
      name: 'Completed Match',
      startsAt: '2026-10-20T10:00:00.000Z',
      status: 'completed',
      enabled: true,
    },
    {
      id: 'disabled-match',
      name: 'Disabled Match',
      startsAt: '2026-10-21T16:00:00.000Z',
      status: 'open',
      enabled: false,
    },
  ].map((tournament) => ({
    ...tournament,
    lifecycle: getTournamentLifecycleState(tournament, now),
  })).filter((tournament) => tournament.lifecycle === 'upcoming' || tournament.lifecycle === 'ongoing');
  const cards = buildAdminRegistrationTournamentCards(activeTournaments, [
    { id: 'approved-future', status: 'approved', tournamentId: 'future-match', teamMembers: [] },
    { id: 'pending-future', status: 'pending', tournamentId: 'future-match' },
    { id: 'approved-live', status: 'approved', tournamentId: 'live-match' },
  ]);

  assert.deepEqual(cards.map((card) => card.id), ['live-match', 'future-match']);
  assert.deepEqual(cards.map((card) => card.approvedPlayerCount), [1, 1]);
  assert.equal(cards[1].rows.length, 1);
  assert.equal(cards[1].totalPlayerSlots, 48);
  assert.equal(cards[1].startLabel, '21 Oct 2026, 09:00 PM IST');
  assert.equal(cards[1].lifecycle, 'upcoming');
  assert.equal(formatAdminRegistrationTime('2026-10-21T15:30:00.000Z'), '21 Oct 2026, 09:00 PM IST');
});

test('tournament selection opens only that match and back returns to the tournament list', () => {
  assert.match(
    screenSource,
    /const tournamentCards = useMemo\([\s\S]*?buildAdminRegistrationTournamentCards\(/,
  );
  assert.match(screenSource, /const selectedTournament = tournamentCards\.find\(\(tournament\) => tournament\.id === selectedTournamentId\)/);
  assert.match(screenSource, /const selectedPlayers = selectedTournament\?\.rows \?\? \[\]/);
  assert.match(screenSource, /selectedPlayers\.map\(renderRegistrationCard\)/);
  assert.match(screenSource, /onPress=\{\(\) => setSelectedTournamentId\(tournament\.id\)\}/);
  assert.match(screenSource, /onPress=\{\(\) => setSelectedTournamentId\(null\)\}/);
  assert.match(screenSource, /testID=\{`admin-approved-tournament-\$\{tournament\.id\}`\}/);
});

test('registration filtering stays strict by tournament ID and approved status', () => {
  const rows = [
    { id: 'squad-pending', status: 'pending', tournamentId: 'br-squad' },
    { id: 'squad-approved', status: 'approved', tournamentId: 'br-squad' },
    { id: 'solo-pending', status: 'pending', tournamentId: 'br-solo' },
    { id: 'prefix-pending', status: 'pending', tournamentId: 'br-squad-2' },
    { id: 'missing-id', status: 'pending', tournamentId: null },
  ];

  assert.deepEqual(
    filterAdminRegistrationRows(rows, 'approved', 'br-squad').map((row) => row.id),
    ['squad-approved'],
  );
});

test('approved registrations group by match ID and keep scheduled times distinct', () => {
  const groups = groupApprovedRegistrationRows([
    {
      id: 'late-player',
      status: 'approved',
      tournamentId: 'solo-9pm',
      tournamentName: 'Battle Royale Solo',
      startsAt: '2026-10-21T15:30:00.000Z',
      totalPlayerSlots: 48,
    },
    {
      id: 'early-team',
      status: 'approved',
      tournamentId: 'solo-8pm',
      tournamentName: 'Battle Royale Solo',
      startsAt: '2026-10-21T14:30:00.000Z',
      totalPlayerSlots: 48,
      teamMembers: [{ name: 'Player 1' }, { name: 'Player 2' }],
    },
    {
      id: 'early-player',
      status: 'approved',
      tournamentId: 'solo-8pm',
      tournamentName: 'Battle Royale Solo',
      startsAt: '2026-10-21T14:30:00.000Z',
      totalPlayerSlots: 48,
    },
    {
      id: 'pending-player',
      status: 'pending',
      tournamentId: 'solo-8pm',
      tournamentName: 'Battle Royale Solo',
      startsAt: '2026-10-21T14:30:00.000Z',
      totalPlayerSlots: 48,
    },
  ]);

  assert.deepEqual(groups.map((group) => group.id), ['solo-8pm', 'solo-9pm']);
  assert.equal(groups[0].approvedPlayerCount, 3);
  assert.equal(groups[0].rows.length, 2);
  assert.equal(groups[1].approvedPlayerCount, 1);
  assert.equal(groups[0].totalPlayerSlots, 48);
  assert.equal(formatAdminRegistrationStart('2026-10-21T14:30:00.000Z'), '21 Oct 2026, 08:00 PM IST');
});

test('approved player cards show name, UID, slot, registration time, copy, and delete actions', () => {
  assert.match(screenSource, /In-Game Name: \{inGameName\}/);
  assert.match(screenSource, /UID: \{uid \|\| '—'\}/);
  assert.match(screenSource, /registrationSlotLabel\(registration\)/);
  assert.match(screenSource, /Registration Time: \{formatAdminRegistrationTime\(registration\.createdAt\)\}/);
  assert.match(screenSource, /title="DELETE"[\s\S]*?onPress=\{\(\) => del\(registration\.id, playerName\)\}/);
  assert.match(screenSource, /uid=\{uid\}[\s\S]*?testID=\{`admin-registration-copy-uid-\$\{registration\.id\}`\}/);
});

test('Admin Registrations API returns the existing individual seat number for Solo slots', () => {
  assert.match(
    apiRouteSource,
    /router\.get\("\/admin\/registrations"[\s\S]*?r\.assigned_group_number,[\s\S]*?assignedGroupNumber: row\.assigned_group_number \?\? null/,
  );
});

test('UID copying uses the exact UID and reports clipboard success or failure', async () => {
  const writes = [];
  assert.equal(
    await copyUidToClipboard('  4545  ', async (value) => {
      writes.push(value);
      return true;
    }),
    true,
  );
  assert.deepEqual(writes, ['4545']);
  assert.equal(await copyUidToClipboard('5454', async () => false), false);
  assert.equal(await copyUidToClipboard('5454', async () => { throw new Error('clipboard unavailable'); }), false);
  assert.equal(await copyUidToClipboard('   ', async () => assert.fail('Blank UIDs must not be copied.')), false);

  assert.match(copyButtonSource, /copyUidToClipboard\(value, Clipboard\.setStringAsync\)/);
  assert.match(copyButtonSource, /if \(copied\) onCopied\?\.\(value\);[\s\S]*?else onCopyFailed\?\.\(value\)/);
  assert.match(
    screenSource,
    /onCopied=\{\(\) => toast\('UID Copied!', 'success'\)\}[\s\S]*?onCopyFailed=\{\(\) => toast\('Could not copy UID\. Please try again\.', 'error'\)\}/,
  );
});

test('each registration card places a copy control beside its displayed game UID', () => {
  assert.match(screenSource, /const uid = String\(registration\.gameUid \|\| registration\.captainGameUid \|\| ''\)\.trim\(\);/);
  assert.match(screenSource, /In-Game Name: \{inGameName\}[\s\S]*?UID: \{uid \|\| '—'\}/);
  assert.match(screenSource, /<CopyUidButton[\s\S]*?uid=\{uid\}[\s\S]*?testID=\{`admin-registration-copy-uid-\$\{registration\.id\}`\}/);
  assert.match(screenSource, /uidRow: \{ flexDirection: 'row', alignItems: 'center'/);
});
