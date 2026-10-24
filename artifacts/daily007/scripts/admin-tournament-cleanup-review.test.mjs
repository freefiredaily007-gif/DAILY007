import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSource = await readFile(
  new URL('../src/screens/AdminTournaments.tsx', import.meta.url),
  'utf8',
);
const apiSource = await readFile(
  new URL('../src/lib/api.ts', import.meta.url),
  'utf8',
);
const routeSource = await readFile(
  new URL('../../api-server/src/routes/daily007-compat-core.ts', import.meta.url),
  'utf8',
);
const cleanupSource = await readFile(
  new URL('../../api-server/src/lib/daily007-tournament-cleanup.ts', import.meta.url),
  'utf8',
);

test('admin tournament screen clearly states the no-age-based-deletion policy', () => {
  const policyCard = screenSource.match(
    /<Card testID="admin-tournament-retention-policy"[\s\S]*?<\/Card>/,
  )?.[0];
  assert.ok(policyCard, 'The retention policy must be visible on the admin tournament screen.');
  assert.match(policyCard, /TOURNAMENT RETENTION POLICY/);
  assert.match(policyCard, /No automatic or age-based deletion/);
  assert.match(
    policyCard,
    /Old unresolved matches remain available until an admin publishes results, cancels and refunds, or deletes the tournament/,
  );
  assert.doesNotMatch(
    policyCard,
    /72.?hour|age cutoff|expired tournament|cleanup deletes|automatic cleanup review/i,
  );
  assert.doesNotMatch(policyCard, /onPress|Api\.(?:deleteTournament|adminDelete|delete)/);
});

test('the removed cleanup preview API no longer advertises age-based deletion fields', () => {
  assert.doesNotMatch(
    apiSource,
    /TournamentCleanupPreview|adminTournamentCleanupPreview|cleanup-preview|retentionHours|eligibleMatches/,
  );
  assert.doesNotMatch(routeSource, /cleanup-preview|getDaily007TournamentCleanupPreview/);
  assert.doesNotMatch(cleanupSource, /CleanupPreview|getDaily007TournamentCleanupPreview/);
});

test('the admin screen and API no longer contain the old automatic-cleanup review copy', () => {
  assert.doesNotMatch(
    screenSource,
    /AUTOMATIC CLEANUP REVIEW|automatic cleanup policy|No tournament has reached 72 hours|MATCH DATA TO DELETE/i,
  );
  assert.doesNotMatch(routeSource, /72.?hour|cleanup cutoff/i);
});
