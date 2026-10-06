import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { adminPublishedResultAccessibilityLabel } from '../src/lib/adminPublishedResultAccessibility.ts';

const screenSource = await readFile(
  new URL('../src/screens/AdminTournaments.tsx', import.meta.url),
  'utf8',
);
const resultsSource = await readFile(
  new URL('../src/screens/AdminResults.tsx', import.meta.url),
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

test('result validation and API errors are politely announced', () => {
  const errorMessage = screenSource.match(
    /<Msg\s+kind="err"\s+text=\{resultError\}\s+accessibilityLiveRegion="polite"\s*\/>/,
  )?.[0];

  assert.ok(errorMessage, 'Result validation and API errors must use a polite live region.');
  assert.match(screenSource, /setResultError\('Enter a valid rank\.'\)/);
  assert.match(screenSource, /const publishError = apiError\(e\)/);
});

test('approved-player load failures use one polite retry announcement without moving focus', () => {
  const failureMessage = screenSource.match(
    /resultRegs === null \?\s*\(\s*resultBusy \? <Loading \/> : (<Text\b[^>]*>Approved registrations could not be loaded\. Close and reopen this panel to retry\.<\/Text>)\s*\)\s*:\s*eligibleResultRegs\.length === 0 \?/,
  )?.[1];

  assert.ok(failureMessage, 'The visible approved-player failure and retry guidance must remain present.');
  assert.match(failureMessage, /accessibilityLiveRegion="polite"/);
  assert.equal(
    (failureMessage.match(/accessibilityLiveRegion="polite"/g) ?? []).length,
    1,
    'The failure guidance must have only one live-region announcement.',
  );
  assert.doesNotMatch(failureMessage, /setAccessibilityFocus|\.focus\(/);
});

test('tournament and room-management errors use polite live regions', () => {
  assert.match(
    screenSource,
    /<Msg kind="err" text=\{err\} accessibilityLiveRegion="polite" \/>/,
    'Tournament create, update, and delete errors must be announced.',
  );
  assert.match(
    screenSource,
    /<Msg kind="err" text=\{loadError\} accessibilityLiveRegion="polite" \/>/,
    'Tournament list refresh errors must remain announced.',
  );
  assert.match(
    screenSource,
    /text=\{`Could not load completed result logs: \$\{apiError\(resultLogsQuery\.error\)\}`\}\s+accessibilityLiveRegion="polite"/,
    'Completed-result log errors must be announced.',
  );
  assert.match(
    screenSource,
    /<Msg kind="err" text=\{roomError\} accessibilityLiveRegion="polite" \/>/,
    'Room save and removal errors must be announced.',
  );
  assert.match(
    screenSource,
    /text=\{`\$\{roomError \|\| 'Room details could not be loaded\.'\} Close and reopen this panel to retry\.`\}\s+accessibilityLiveRegion="polite"/,
    'Room detail loading errors must be announced.',
  );
});

test('the standalone Results screen connects validation and API errors to a polite live region', () => {
  assert.match(
    resultsSource,
    /<Msg kind="err" text=\{err\} accessibilityLiveRegion="polite" \/>/,
  );
  assert.match(resultsSource, /setErr\('Enter a valid rank\.'\)/);
  assert.match(resultsSource, /catch \(e: any\) \{ setErr\(apiError\(e\)\); \}/);
});

test('the shared Msg forwards live-region semantics without replacing its existing text styling', () => {
  assert.match(uiSource, /accessibilityLiveRegion\?: 'none' \| 'polite' \| 'assertive';/);
  assert.match(uiSource, /accessibilityLiveRegion=\{accessibilityLiveRegion\}/);
  assert.match(
    uiSource,
    /style=\{\[\{ color: ok \? C\.green : C\.red, fontSize: 13, fontWeight: '600' \}, adminSurface && adminSt\.bodyText\]\}/,
  );
});

test('ambiguous submissions refresh saved results and show the stored rank and prize', () => {
  const publishMethod = screenSource.slice(
    screenSource.indexOf('const publishResult = async'),
    screenSource.indexOf('\n  useEffect(() => { load(); }, [load]);'),
  );
  const catchBody = publishMethod.match(/} catch \(e: any\) \{([\s\S]*?)\n    } finally/)?.[1];

  assert.ok(catchBody, 'The publish flow must handle and recover from submission errors.');
  assert.match(screenSource, /const resultLogsParams = \{ includeUnfinalized: true \}/);
  assert.match(catchBody, /await resultLogsQuery\.refetch\(\)/);
  assert.match(
    catchBody,
    /entry\.tournamentId === tournament\.id && entry\.registrationId === registrationId/,
  );
  assert.match(
    catchBody,
    /\$\{RESULT_ALREADY_PUBLISHED_PREFIX\}\$\{playerLabel\} · rank \$\{savedRank\} · prize \$\{savedPrizeCoins\.toLocaleString\(\)\} coins\./,
  );
  assert.match(catchBody, /setSelectedRegistrationId\(''\)/);
  assert.match(catchBody, /setPublishedRegistrationIds/);
  assert.match(catchBody, /setResultError\(publishError\)/);
  assert.match(catchBody, /Could not confirm whether this result was saved/);
  assert.doesNotMatch(catchBody, /Api\.adminPublishResult/);
});

test('placement and winner publication success messages are politely announced', () => {
  const placementMessage = screenSource.match(
    /<Msg\s+kind="ok"\s+text=\{resultSuccess\}\s+accessibilityLiveRegion="polite"\s*\/>/,
  )?.[0];
  const winnerMessage = screenSource.match(
    /<Msg\s+kind="ok"\s+text=\{okMsg\}[\s\S]*?accessibilityLiveRegion=\{[\s\S]*?WINNER_PUBLISH_SUCCESS_MESSAGE[\s\S]*?RESULT_ALREADY_PUBLISHED_PREFIX[\s\S]*?\}\s*\/>/,
  )?.[0];

  assert.ok(placementMessage, 'Placement success must use a polite live region.');
  assert.ok(winnerMessage, 'Winner success must use a polite live region.');
  assert.match(screenSource, /setResultSuccess\('Placement published\. The tournament stays ongoing until rank 1 is declared\.'\)/);
  assert.match(
    screenSource,
    /const WINNER_PUBLISH_SUCCESS_MESSAGE = 'Winner published — prize credited and tournament completed\.'/,
  );
  assert.match(screenSource, /setOkMsg\(WINNER_PUBLISH_SUCCESS_MESSAGE\)/);
});

test('published result rows announce rank, player or team, kills, and prize separately', () => {
  const mapStart = screenSource.indexOf('{tournamentResults.map((entry) => {');
  const mapEnd = screenSource.indexOf('\n                    })}', mapStart);
  assert.ok(mapStart >= 0 && mapEnd > mapStart, 'completed results should render from saved entries');
  const mapSource = screenSource.slice(mapStart, mapEnd);

  assert.equal(
    (mapSource.match(/<Text\b/g) ?? []).length,
    1,
    'each saved entry should map to its own accessible text element',
  );
  assert.match(mapSource, /key=\{entry\.registrationId\}/);
  assert.match(mapSource, /\baccessible\b/);
  assert.match(mapSource, /accessibilityRole="text"/);
  assert.match(
    mapSource,
    /accessibilityLabel=\{adminPublishedResultAccessibilityLabel\(entry\)\}/,
  );
  assert.match(
    mapSource,
    /testID=\{`completed-result-entry-\$\{entry\.registrationId\}`\}/,
  );

  const entries = [
    {
      rank: 1,
      gameName: 'Mock Player One',
      teamName: 'Mock Team One',
      kills: 8,
      prizeCoins: 10000,
    },
    {
      rank: 2,
      teamName: 'Mock Team Two',
      kills: 5,
      prizeCoins: 2500,
    },
  ];
  assert.deepEqual(entries.map(adminPublishedResultAccessibilityLabel), [
    'Rank 1, Mock Player One, team Mock Team One, 8 kills, prize 10,000 coins',
    'Rank 2, team Mock Team Two, 5 kills, prize 2,500 coins',
  ]);
});

test('the shared text input forwards its accessibility props to the native input', () => {
  assert.match(typographySource, /<NativeTextInput\s+ref=\{ref\}\s+\{\.\.\.props\}/);
});