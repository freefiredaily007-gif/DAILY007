import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const screenSource = await readFile(
  new URL('../src/screens/AdminTournaments.tsx', import.meta.url),
  'utf8',
);
const uiSource = await readFile(
  new URL('../src/components/ui.tsx', import.meta.url),
  'utf8',
);
const typographySource = await readFile(
  new URL('../src/components/typography.tsx', import.meta.url),
  'utf8',
);

test('result player choices identify each player and expose the selected state', () => {
  assert.match(screenSource, /accessibilityRole="radio"/);
  assert.match(
    screenSource,
    /accessibilityLabel=\{`\$\{selected \? 'Selected player' : 'Player choice'\}: \$\{playerLabel\}, Free Fire UID \$\{registration\.gameUid \|\| 'not available'\}`\}/,
  );
  assert.match(screenSource, /accessibilityState=\{\{ checked: selected \}\}/);
  assert.match(screenSource, /accessibilityHint="Selects this player for tournament result entry\."/);
  assert.match(screenSource, /testID=\{`result-registration-\$\{registration\.id\}`\}/);
});

test('rank and kills inputs have distinct names and clear entry guidance', () => {
  const rankInput = screenSource.match(/<Input\s+placeholder="Rank \*"[\s\S]*?\/>/)?.[0];
  const killsInput = screenSource.match(/<Input\s+placeholder="Kills, optional"[\s\S]*?\/>/)?.[0];

  assert.ok(rankInput, 'The required rank input must remain present.');
  assert.match(rankInput, /accessibilityLabel="Rank, required"/);
  assert.match(rankInput, /whole number greater than zero/);
  assert.match(rankInput, /testID=\{`result-rank-\$\{t\.id\}`\}/);

  assert.ok(killsInput, 'The optional kills input must remain present.');
  assert.match(killsInput, /accessibilityLabel="Kills, optional"/);
  assert.match(killsInput, /non-negative whole number/);
  assert.match(killsInput, /testID=\{`result-kills-\$\{t\.id\}`\}/);
});

test('calculated prize is announced as read-only and updated politely', () => {
  const prizeView = screenSource.match(/<View\s+accessible\s+accessibilityRole="text"[\s\S]*?style=\{st\.prizeBox\}\s*>/)?.[0];

  assert.ok(prizeView, 'The calculated prize must be a single accessible text element.');
  assert.match(prizeView, /accessibilityLabel=\{`Calculated prize: \$\{resultPrizeCoins\.toLocaleString\(\)\} coins`\}/);
  assert.match(prizeView, /read-only/);
  assert.match(prizeView, /accessibilityLiveRegion="polite"/);
  assert.match(prizeView, /testID=\{`result-prize-\$\{t\.id\}`\}/);
});

test('publish action names the player and rank, and exposes publishing state', () => {
  const publishButton = screenSource.match(/<Btn\s+title=\{Number\(resultRank\) === 1[\s\S]*?disabled=\{resultBusy\}\s*\/>/)?.[0];

  assert.ok(publishButton, 'The result publish button must remain present.');
  assert.match(publishButton, /accessibilityLabel=\{`Publish \$\{Number\(resultRank\) === 1 \? 'winner' : 'placement'\} for \$\{selectedResultPlayerLabel\}, rank \$\{resultRank \|\| 'not entered'\}`\}/);
  assert.match(publishButton, /accessibilityState=\{\{ disabled: resultBusy, busy: resultBusy \}\}/);
  assert.match(publishButton, /testID=\{`publish-result-\$\{t\.id\}`\}/);
  assert.match(uiSource, /accessibilityHint=\{accessibilityHint\}/);
  assert.match(uiSource, /accessibilityState=\{accessibilityState\}/);
});

test('the shared text input forwards its accessibility props to the native input', () => {
  assert.match(typographySource, /<NativeTextInput\s+\{\.\.\.props\}/);
});