import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatAdminDateTime } from '../src/lib/adminApprovedRegistrationMatches.ts';

const readScreen = (name) => readFile(
  new URL(`../src/screens/${name}.tsx`, import.meta.url),
  'utf8',
);

test('formats UTC timestamps in IST with a zero-padded 12-hour clock', () => {
  assert.equal(
    formatAdminDateTime('2026-10-22T11:43:21.121Z'),
    '22 Oct 2026, 05:13 PM IST',
  );
  assert.equal(
    formatAdminDateTime('2026-10-22T17:13:21.121+05:30'),
    '22 Oct 2026, 05:13 PM IST',
  );
  assert.equal(formatAdminDateTime('not-a-timestamp'), 'Time unavailable');
  assert.equal(formatAdminDateTime(null, '—'), '—');
});

test('admin activity and record timestamps use the shared IST formatter', async () => {
  const screens = Object.fromEntries(await Promise.all(
    ['AdminDashboard', 'AdminTournaments', 'AdminUsers', 'AdminPayments', 'AdminWallet', 'AdminEarnTasks']
      .map(async (name) => [name, await readScreen(name)]),
  ));

  assert.match(screens.AdminDashboard, /formatAdminDateTime\(a\.time\)/);
  assert.match(screens.AdminTournaments, /formatAdminDateTime as formatAuditTimestamp/);
  assert.match(screens.AdminUsers, /formatAdminDateTime\(item\.createdAt\)/);
  assert.match(screens.AdminPayments, /formatAdminDateTime\(p\.createdAt\)/);
  assert.match(screens.AdminWallet, /formatAdminDateTime\(t\.createdAt\)/);
  assert.match(screens.AdminEarnTasks, /formatAdminDateTime\(claim\.createdAt\)/);
  assert.match(screens.AdminEarnTasks, /formatAdminDateTime\(claim\.reviewedAt\)/);
});
