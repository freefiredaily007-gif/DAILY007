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

test('cleanup preview API is typed and uses a fresh read-only request', () => {
  assert.match(apiSource, /export type TournamentCleanupPreview = \{/);
  assert.match(apiSource, /retentionHours: 72;/);
  assert.match(
    apiSource,
    /adminTournamentCleanupPreview: \(\): Promise<TournamentCleanupPreview> =>\s*unwrap\(http\.get\('\/admin\/tournaments\/cleanup-preview', \{ headers: LIVE_DATA_HEADERS \}\)\)/,
  );
});

test('cleanup review shows its cutoff, eligibility policy, candidates, and protected history', () => {
  assert.match(screenSource, /AUTOMATIC CLEANUP REVIEW/);
  assert.match(screenSource, /READ-ONLY · Shows the automatic cleanup policy/);
  assert.match(screenSource, /cleanupPreview\.retentionHours/);
  assert.match(screenSource, /cleanupPreview\.cutoffAt/);
  assert.match(screenSource, /cleanupPreview\.generatedAt/);
  assert.match(screenSource, /eligible empty terminal/);
  assert.match(screenSource, /have no registrations, roster or squad records, published results, or wallet history/);
  assert.match(screenSource, /registrationRowsPreserved/);
  assert.match(screenSource, /publishedResultAwards/);
  assert.match(screenSource, /walletLedgerRows/);
  assert.match(screenSource, /cleanupPreview\.candidates\.map/);
  assert.match(screenSource, /formatAuditTimestamp\(candidate\.startsAt\)/);
  assert.match(screenSource, /No empty terminal matches currently meet every cleanup condition/);
  assert.match(screenSource, /No matches have reached the 72-hour review window/);
});

test('cleanup review has accessible loading, retryable error, empty, and read-only states', () => {
  const panel = screenSource.match(
    /<Card testID="admin-tournament-cleanup-review"[\s\S]*?<\/Card>\s*\{tab === 'completed' && resultLogsQuery\.isError/,
  )?.[0];
  assert.ok(panel, 'The cleanup review panel must be rendered with the tournament admin screen.');
  assert.match(panel, /accessibilityLiveRegion="polite"/);
  assert.match(panel, /testID="admin-tournament-cleanup-loading"/);
  assert.match(panel, /testID="admin-tournament-cleanup-error"/);
  assert.match(panel, /testID="admin-tournament-cleanup-retry"/);
  assert.match(panel, /accessibilityLabel="Retry loading cleanup review"/);
  assert.match(panel, /testID="admin-tournament-cleanup-empty"/);
  assert.doesNotMatch(panel, /Api\.(?:deleteTournament|adminDelete|delete)/);
  assert.match(
    screenSource,
    /const loadCleanupPreview = useCallback\(async \(\) => \{[\s\S]*await Api\.adminTournamentCleanupPreview\(\)[\s\S]*setCleanupPreviewError\(`Cleanup review is unavailable:[\s\S]*\}, \[\]\);/,
  );
});
