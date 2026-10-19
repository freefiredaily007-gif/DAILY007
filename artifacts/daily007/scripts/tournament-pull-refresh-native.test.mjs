import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [screen, route, tournamentScreen, flow, emulatorScript, packageJson] = await Promise.all([
  read('../src/screens/TournamentPullRefreshNativeTest.tsx'),
  read('../app/tournament-pull-refresh-test.tsx'),
  read('../src/screens/Tournaments.tsx'),
  read('../maestro/tournament-pull-refresh/poll-is-superseded-by-pull.yaml'),
  read('../../../.github/scripts/android-emulator-verification.sh'),
  read('../package.json').then(JSON.parse),
]);

test('native refresh fixture mounts the production tournament screen with controlled responses', () => {
  assert.match(route, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(screen, /import Tournaments from '\.\/Tournaments'/);
  assert.match(screen, /<Stack\.Screen name="Tournaments" component=\{Tournaments\} \/>/);
  assert.match(screen, /\(Api as any\)\.tournaments = getTournaments/);
  assert.match(screen, /pollResponse\.current = resolve/);
  assert.match(screen, /manualResponse\.current = resolve/);
  assert.match(screen, /resolve\(\[newestTournament\]\)/);
  assert.match(screen, /resolve\(\[staleTournament\]\)/);
  assert.match(tournamentScreen, /refreshControl=\{<RefreshControl refreshing=\{refreshing\} onRefresh=\{onRefresh\}/);
  assert.match(
    tournamentScreen,
    /trigger === 'manual' && activeLoadTrigger\.current === 'scheduled'/,
  );
});

test('Android flow pulls while the scheduled response is pending, resolves newer first, and keeps it', () => {
  assert.match(flow, /Scheduled poll response pending/);
  assert.match(flow, /- swipe:/);
  assert.match(flow, /Manual response pending/);
  assert.ok(flow.indexOf('tournament-pull-refresh-resolve-manual') <
    flow.indexOf('tournament-pull-refresh-resolve-poll'));
  assert.match(flow, /assertVisible: "Newest pull result"/);
  assert.match(flow, /assertNotVisible: "Stale poll result"/);
  assert.equal(
    packageJson.scripts['test:android-tournament-pull-refresh'],
    'maestro test --test-output-dir="${MAESTRO_TEST_OUTPUT_DIR:-$HOME/.maestro/tests}" maestro/tournament-pull-refresh',
  );
  assert.match(emulatorScript, /run_maestro_suite tournament-pull-refresh test:android-tournament-pull-refresh/);
});
