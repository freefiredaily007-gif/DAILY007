import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const adminScreen = await readFile(
  new URL('../src/screens/AdminTournaments.tsx', import.meta.url),
  'utf8',
);
const apiRoutes = await readFile(
  new URL('../../api-server/src/routes/daily007-compat-core.ts', import.meta.url),
  'utf8',
);

test('upcoming and ongoing tournament cards expose the guarded cancel-and-refund action', () => {
  assert.match(adminScreen, /const cancellable = !cancelled && !finished/);
  assert.equal([...adminScreen.matchAll(/testID=\{`cancel-tournament-\$\{t\.id\}`\}/g)].length, 2);
  assert.doesNotMatch(adminScreen, /filledSlots[\s\S]{0,100}totalSlots/);
  assert.match(adminScreen, /tournament with a published winner cannot be cancelled/i);
});

test('admin cancellation remains role-gated and calls the atomic refund operation', () => {
  const routeStart = apiRoutes.indexOf('router.post("/admin/tournaments/:id/lifecycle"');
  const routeEnd = apiRoutes.indexOf('function tournamentValues', routeStart);
  assert.notEqual(routeStart, -1);
  assert.notEqual(routeEnd, -1);
  const route = apiRoutes.slice(routeStart, routeEnd);
  assert.match(route, /requireTournamentAdmin\(req, res\)/);
  assert.match(route, /cancelTournamentAndRefundForAdmin\(id\)/);
});
