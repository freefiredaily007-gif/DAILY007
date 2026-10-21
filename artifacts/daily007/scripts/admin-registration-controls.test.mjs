import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { copyUidToClipboard } from '../src/lib/copyUidToClipboard.ts';
import { filterAdminRegistrationRows } from '../src/lib/adminRegistrationFilter.ts';

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
    /testID="admin-registration-tournament-filter-all"[\s\S]*?onPress=\{\(\) => setTournamentFilter\(''\)\}/,
  );
  assert.match(
    screenSource,
    /testID=\{`admin-registration-tournament-filter-\$\{t\.id\}`\}[\s\S]*?onPress=\{\(\) => setTournamentFilter\(t\.id\)\}/,
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
  assert.match(screenSource, /const uid = String\(r\.gameUid \|\| r\.captainGameUid \|\| ''\)\.trim\(\);/);
  assert.match(screenSource, /In-game name:[\s\S]*?UID: \{uid \|\| '—'\}/);
  assert.match(screenSource, /<CopyUidButton[\s\S]*?uid=\{uid\}[\s\S]*?testID=\{`admin-registration-copy-uid-\$\{r\.id\}`\}/);
  assert.match(screenSource, /uidRow: \{ flexDirection: 'row', alignItems: 'center'/);
});
