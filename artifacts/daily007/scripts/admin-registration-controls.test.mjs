import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { copyUidToClipboard } from '../src/lib/copyUidToClipboard.ts';
import { filterAdminRegistrationRows } from '../src/lib/adminRegistrationFilter.ts';
import {
  formatAdminRegistrationStart,
  groupApprovedRegistrationRows,
} from '../src/lib/adminApprovedRegistrationMatches.ts';

const screenSource = await readFile(
  new URL('../src/screens/AdminRegs.tsx', import.meta.url),
  'utf8',
);
const copyButtonSource = await readFile(
  new URL('../src/components/CopyUidButton.tsx', import.meta.url),
  'utf8',
);

test('tournament registration filtering uses exact tournament ID and the active status', () => {
  const rows = [
    { id: 'squad-pending', status: 'pending', tournamentId: 'br-squad' },
    { id: 'squad-approved', status: 'approved', tournamentId: 'br-squad' },
    { id: 'solo-pending', status: 'pending', tournamentId: 'br-solo' },
    { id: 'prefix-pending', status: 'pending', tournamentId: 'br-squad-2' },
    { id: 'missing-id', status: 'pending', tournamentId: null },
  ];

  assert.deepEqual(
    filterAdminRegistrationRows(rows, 'pending', 'br-squad').map((row) => row.id),
    ['squad-pending'],
  );
  assert.deepEqual(
    filterAdminRegistrationRows(rows, 'pending', '').map((row) => row.id),
    ['squad-pending', 'solo-pending', 'prefix-pending', 'missing-id'],
  );
});

test('Admin Registrations wires the tournament chips to the exact card filter and All reset', () => {
  assert.match(
    screenSource,
    /const list = filterAdminRegistrationRows\(all \?\? \[\], tab, tournamentFilter\);/,
  );
  assert.match(
    screenSource,
    /testID="admin-registration-tournament-filter-all"[\s\S]*?onPress=\{\(\) => \{ setTournamentFilter\(''\); setApprovedMatchFilter\(''\); \}\}/,
  );
  assert.match(
    screenSource,
    /testID=\{`admin-registration-tournament-filter-\$\{t\.id\}`\}[\s\S]*?onPress=\{\(\) => \{ setTournamentFilter\(t\.id\); setApprovedMatchFilter\(''\); \}\}/,
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
  assert.equal(formatAdminRegistrationStart('2026-10-21T14:30:00.000Z'), '21 Oct 2026 · 8:00 PM IST');
});

test('approved match selection filters the roster and scopes CSV to that exact match', () => {
  assert.match(screenSource, /groupApprovedRegistrationRows\(\s*filterAdminRegistrationRows\(all \?\? \[\], 'approved', tournamentFilter\)/);
  assert.match(screenSource, /approvedMatchGroups\.filter\(\(group\) => group\.id === approvedMatchFilter\)/);
  assert.match(screenSource, /testID=\{`admin-approved-match-filter-\$\{group\.id\}`\}/);
  assert.match(screenSource, /testID=\{`admin-approved-match-group-\$\{group\.id\}`\}/);
  assert.match(screenSource, /totalPlayerSlots[\s\S]*?APPROVED PLAYERS/);
  assert.match(screenSource, /tab === 'approved'\s*\?\s*\(selectedApprovedMatch\?\.rows \?\? \[\]\)\.filter\(\(r\) => r\.status === 'approved'\)/);
  assert.match(screenSource, /testID="admin-registration-approved-csv"[\s\S]*?disabled=\{!selectedApprovedMatch \|\| exportBusy\}/);
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
  assert.match(screenSource, /const uid = String\(r\.gameUid \|\| r\.captainGameUid \|\| ''\)\.trim\(\);/);
  assert.match(screenSource, /In-game name:[\s\S]*?UID: \{uid \|\| '—'\}/);
  assert.match(screenSource, /<CopyUidButton[\s\S]*?uid=\{uid\}[\s\S]*?testID=\{`admin-registration-copy-uid-\$\{r\.id\}`\}/);
  assert.match(screenSource, /uidRow: \{ flexDirection: 'row', alignItems: 'center'/);
});
