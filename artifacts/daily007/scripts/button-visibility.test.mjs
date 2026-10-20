import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [uiSource, adminTournamentsSource, tournamentDetailSource] = await Promise.all([
  readSource('../src/components/ui.tsx'),
  readSource('../src/screens/AdminTournaments.tsx'),
  readSource('../src/screens/TDetail.tsx'),
]);
const btnStart = uiSource.indexOf('export function Btn(');
const btnEnd = uiSource.indexOf('// ---------- glass card ----------', btnStart);
const btnSource = uiSource.slice(btnStart, btnEnd);

test('shared animated buttons use concrete styles and retain press feedback', () => {
  assert.match(btnSource, /style=\{\[/);
  assert.doesNotMatch(btnSource, /style=\{\(\{\s*pressed\s*\}\)\s*=>/);
  assert.match(btnSource, /onPress=\{onPress\}/);
  assert.match(btnSource, /setPressed\(true\)/);
  assert.match(btnSource, /setPressed\(false\)/);
  assert.match(btnSource, /opacity: disabled \? 0\.4 : pressed \? 0\.8 : 1/);
  assert.match(btnSource, /disabled=\{disabled \|\| \(loading && !preserveAccessibilityFocusWhileLoading\)\}/);
});

test('tournament create and join actions remain connected to the shared button', () => {
  assert.match(adminTournamentsSource, /title=\{showForm \? 'CLOSE CREATE FORM' : 'ADD NEW TOURNAMENT'\}/);
  assert.match(adminTournamentsSource, /testID="admin-tournament-create-toggle"/);
  assert.match(adminTournamentsSource, /setShowForm\(!showForm\)/);
  assert.match(tournamentDetailSource, /onPress=\{join\}/);
  assert.match(tournamentDetailSource, /title=\{`JOIN NOW —/);
});
