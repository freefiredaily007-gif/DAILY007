import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Home-to-match native fixture is dev-only and mounts the real screens with local fixtures', async () => {
  const [route, fixture] = await Promise.all([
    read('app/home-match-back-test.tsx'),
    read('src/screens/HomeMatchBackNativeTest.tsx'),
  ]);

  assert.match(route, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(fixture, /import Home from '\.\/Home'/);
  assert.match(fixture, /import TDetail from '\.\/TDetail'/);
  assert.match(fixture, /NavigationIndependentTree/);
  assert.match(fixture, /<Tab\.Screen name="Home" component=\{Home\}/);
  assert.match(fixture, /<Stack\.Screen name="TDetail" component=\{TDetail\}/);
  assert.match(fixture, /native-home-back-test-player/);
  assert.match(fixture, /Home Back Test Match One/);
  assert.match(fixture, /Home Back Test Match Two/);
  assert.match(fixture, /Missing native navigation fixture/);
});

test('Maestro exercises two Home cards with native Android Back between details', async () => {
  const flow = await read('maestro/home-match-back/home-to-match-back.yaml');

  assert.match(flow, /home-match-back-test/);
  assert.match(flow, /home-upcoming-card-home-back-match-one/);
  assert.match(flow, /Home Back Test Match One/);
  assert.match(flow, /home-upcoming-card-home-back-match-two/);
  assert.match(flow, /Home Back Test Match Two/);
  assert.equal((flow.match(/pressKey: BACK/g) ?? []).length, 2);
  assert.match(flow, /direction: LEFT/);
});

test('the Android release emulator workflow runs the Home-to-match Back flow', async () => {
  const [packageSource, workflow] = await Promise.all([
    read('package.json'),
    read('../../.github/scripts/android-emulator-verification.sh'),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.match(packageJson.scripts['test:android-home-match-back'], /maestro test .*maestro\/home-match-back/);
  assert.match(workflow, /run_maestro_suite home-match-back test:android-home-match-back/);
});
