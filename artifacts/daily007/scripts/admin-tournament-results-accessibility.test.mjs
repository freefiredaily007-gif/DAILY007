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

test('iOS VoiceOver announces new tournament, room, and result errors without moving focus', () => {
  const announcementEffect = screenSource.match(
    /useEffect\(\(\) => \{\s*if \(Platform\.OS !== 'ios'\) return;[\s\S]*?\}, \[err, loadError, roomError, resultError\]\);/,
  )?.[0];

  assert.ok(announcementEffect, 'Tournament screen errors must be announced on iOS.');
  for (const errorKey of ['err', 'loadError', 'roomError', 'resultError']) {
    assert.match(announcementEffect, new RegExp(`\\['[^']+', ${errorKey}\\]`));
  }
  assert.match(announcementEffect, /message !== announcedErrors\.current\[key\]/);
  assert.match(announcementEffect, /AccessibilityInfo\.announceForAccessibilityWithOptions/);
  assert.match(announcementEffect, /queue: true/);
  assert.doesNotMatch(announcementEffect, /setAccessibilityFocus|\.focus\(/);
  assert.match(screenSource, /<Msg kind="err" text=\{err\} accessibilityLiveRegion="polite" \/>/);
  assert.match(screenSource, /text=\{roomError\} accessibilityLiveRegion="polite"/);
  assert.match(screenSource, /text=\{resultError\} accessibilityLiveRegion="polite"/);
});

test('iOS VoiceOver announces Results validation and API errors without moving focus', () => {
  const announcementEffect = resultsSource.match(
    /useEffect\(\(\) => \{\s*if \(Platform\.OS !== 'ios'\) return;[\s\S]*?\}, \[err, listLoadError, regLoadError\]\);/,
  )?.[0];

  assert.ok(announcementEffect, 'Admin Results errors must be announced on iOS.');
  assert.match(announcementEffect, /\['result', err\]/);
  assert.match(announcementEffect, /\['tournament-list', listLoadError\]/);
  assert.match(announcementEffect, /\['approved-registrations', regLoadError\]/);
  assert.match(announcementEffect, /message !== announcedErrors\.current\[key\]/);
  assert.match(announcementEffect, /AccessibilityInfo\.announceForAccessibilityWithOptions/);
  assert.match(announcementEffect, /queue: true/);
  assert.doesNotMatch(announcementEffect, /setAccessibilityFocus|\.focus\(/);
  assert.match(resultsSource, /<Msg kind="err" text=\{err\} accessibilityLiveRegion="polite" \/>/);
  assert.match(resultsSource, /<Msg kind="err" text=\{listLoadError\} accessibilityLiveRegion="polite" \/>/);
});

test('the standalone Results screen separates a successful empty registration list from a retryable failure', () => {
  const loaderStart = resultsSource.indexOf('const loadApprovedRegistrations = useCallback(async');
  const loaderEnd = resultsSource.indexOf('\n  }, []);', loaderStart);
  const loader = resultsSource.slice(loaderStart, loaderEnd);
  assert.ok(loaderStart >= 0 && loaderEnd > loaderStart, 'Approved registrations must have a dedicated loader.');
  assert.match(loader, /await Api\.adminApprovedRegs\(t\.id\)/);
  assert.match(loader, /setRegs\(approved\)/);
  assert.match(loader, /catch \(e: any\)[\s\S]*setRegLoadError\(apiError\(e\)\)[\s\S]*setHasRegLoadFailed\(true\)/);
  assert.doesNotMatch(loader, /setRegs\(\[\]\)/, 'A failed request must not be rendered as a successful empty response.');

  const stateStart = resultsSource.indexOf('{regs === null ? hasRegLoadFailed');
  const stateEnd = resultsSource.indexOf('<View style={{ flexDirection:', stateStart);
  const registrationState = resultsSource.slice(stateStart, stateEnd);
  assert.ok(stateStart >= 0 && stateEnd > stateStart);
  assert.match(registrationState, /Approved registrations could not be loaded:/);
  assert.match(registrationState, /Retrying approved registrations…/);
  assert.match(registrationState, /accessibilityLiveRegion="polite"/);
  assert.match(registrationState, /title=\{regsLoading \? 'RETRYING…' : 'RETRY APPROVED PLAYERS'\}/);
  assert.match(registrationState, /accessibilityLabel="Retry approved registrations"/);
  assert.match(registrationState, /accessibilityState=\{\{ disabled: regsLoading, busy: regsLoading \}\}/);
  assert.match(registrationState, /preserveAccessibilityFocusWhileLoading/);
  assert.match(registrationState, /testID=\{`retry-approved-registrations-\$\{sel\.id\}`\}/);
  assert.match(registrationState, /onPress=\{retryApprovedRegistrations\}/);
  assert.match(registrationState, /title="NO APPROVED PLAYERS"/);
  assert.match(registrationState, /text="No approved registrations are available for this tournament\."/);
  assert.match(registrationState, /accessibilityLabel="No approved registrations are available for this tournament\."/);
  assert.match(registrationState, /accessibilityLiveRegion="polite"/);
  assert.match(
    registrationState,
    /regs === null \? hasRegLoadFailed \?[\s\S]*Approved registrations could not be loaded[\s\S]*:\s*<Loading[\s\S]*:\s*regs\.length === 0 \? \([\s\S]*<Empty/,
    'The retryable error renders only for an unsuccessful request, while the empty state requires loaded registration data.',
  );

  assert.match(
    resultsSource,
    /const retryApprovedRegistrations = \(\) => \{\s*if \(!sel \|\| regsLoading\) return;[\s\S]*void loadApprovedRegistrations\(sel, currentRequest\);/,
  );
});

test('approved-player load failures use one polite retry announcement without moving focus', () => {
  const failureMessage = screenSource.match(
    /<Text accessibilityLiveRegion="polite" style=\{st\.actionHint\}>[\s\S]*?\{resultBusy[\s\S]*?'Approved registrations could not be loaded\. Retry here\. If the problem continues, close and reopen this panel\.'[\s\S]*?<\/Text>/,
  )?.[0];

  assert.ok(failureMessage, 'The visible approved-player failure and retry guidance must remain present.');
  assert.match(failureMessage, /accessibilityLiveRegion="polite"/);
  assert.equal(
    (failureMessage.match(/accessibilityLiveRegion="polite"/g) ?? []).length,
    1,
    'The failure guidance must have only one live-region announcement.',
  );
  assert.doesNotMatch(failureMessage, /setAccessibilityFocus|\.focus\(/);
  assert.match(screenSource, /accessibilityLabel="Retry approved registrations"/);
  assert.match(screenSource, /accessibilityHint=\{`Loads approved registrations for \$\{t\.name\} without closing Result Entry\.`\}/);
  assert.match(screenSource, /testID=\{`retry-approved-registrations-\$\{t\.id\}`\}/);
});

test('Result Entry announces distinct successful empty states separately from load failures', () => {
  assert.match(
    screenSource,
    /const resultEmptyTitle = resultRegs === null\s*\?\s*''\s*:\s*resultRegs\.length === 0\s*\?\s*'NO APPROVED PLAYERS'\s*:\s*'ALL RESULTS PUBLISHED';/,
    'The empty-state heading must distinguish no approved players from already-published results.',
  );
  assert.match(
    screenSource,
    /const resultEmptyMessage = resultRegs === null\s*\?\s*''\s*:\s*resultRegs\.length === 0\s*\?\s*'No approved registrations for this tournament\.'\s*:\s*'Every approved player already has a published result\.';/,
    'A successful empty response and an all-published response must have different messages.',
  );

  const resultEntryStart = screenSource.indexOf('{resultRegs === null ?');
  const playerChoicesStart = screenSource.indexOf('<Text style={st.lbl}>SELECT PLAYER', resultEntryStart);
  assert.ok(resultEntryStart >= 0 && playerChoicesStart > resultEntryStart);
  const resultEntryState = screenSource.slice(resultEntryStart, playerChoicesStart);
  assert.match(
    resultEntryState,
    /resultRegs === null \?[\s\S]*?Retrying approved registrations…[\s\S]*?Loading approved registrations…[\s\S]*?Approved registrations could not be loaded\. Retry here\.[\s\S]*?RETRY APPROVED PLAYERS[\s\S]*?:\s*eligibleResultRegs\.length === 0 \?\s*\(\s*<Empty[\s\S]*?\/>\s*\)/,
    'Only a failed or pending request should use the load-failure guidance.',
  );

  const emptyState = resultEntryState.match(/<Empty[\s\S]*?\/>/)?.[0];
  assert.ok(emptyState, 'A successful empty response must render the shared empty state.');
  assert.match(emptyState, /title=\{resultEmptyTitle\}/);
  assert.match(emptyState, /text=\{resultEmptyMessage\}/);
  assert.match(emptyState, /accessibilityLabel=\{resultEmptyMessage\}/);
  assert.equal(
    (emptyState.match(/accessibilityLiveRegion="polite"/g) ?? []).length,
    1,
    'The selected successful empty-state message must have one polite announcement.',
  );
  assert.doesNotMatch(
    resultEntryState,
    /Approved registrations could not be loaded[\s\S]*No approved registrations|No approved registrations[\s\S]*Approved registrations could not be loaded/,
    'Load-failure guidance must not be combined with a successful empty-state message.',
  );

  const loadStart = screenSource.indexOf('const loadApprovedRegistrations = async');
  const loadEnd = screenSource.indexOf('\n  const retryApprovedRegistrations', loadStart);
  const loadApprovedPlayers = screenSource.slice(loadStart, loadEnd);
  assert.match(loadApprovedPlayers, /await Api\.adminApprovedRegs\(tournamentId\)/);
  assert.match(loadApprovedPlayers, /setResultBusy\(true\)/);
  assert.match(loadApprovedPlayers, /setResultRegs\(registrations\)/);
  assert.match(loadApprovedPlayers, /catch \(e: any\)[\s\S]*setResultRegs\(null\)/);
  const actionEnd = screenSource.indexOf('\n  const saveRoom', screenSource.indexOf('const toggleTournamentAction'));
  const actionStart = screenSource.indexOf('const toggleTournamentAction');
  const resultEntryOpen = screenSource.slice(actionStart, actionEnd);
  assert.match(
    resultEntryOpen,
    /setResultError\(''\); setResultSuccess\(''\);[\s\S]*setResultRegs\(null\);[\s\S]*await loadApprovedRegistrations\(tournament\.id, requestId\)/,
    'Opening Result Entry must clear stale messages before loading the current response.',
  );
  assert.match(
    uiSource,
    /accessibilityLiveRegion=\{accessibilityLiveRegion\}/,
    'The shared empty-state text must forward the polite live-region semantics.',
  );
});

test('inline approved-player retry is scoped to the active tournament and deduplicates requests', () => {
  const loaderStart = screenSource.indexOf('const loadApprovedRegistrations = async');
  const retryStart = screenSource.indexOf('const retryApprovedRegistrations', loaderStart);
  const toggleStart = screenSource.indexOf('const toggleTournamentAction', retryStart);
  const loader = screenSource.slice(loaderStart, retryStart);
  const retry = screenSource.slice(retryStart, toggleStart);

  assert.match(loader, /approvedRegistrationsRequestId\.current === requestId/);
  assert.match(loader, /if \(actionRequestId\.current !== requestId\) return/);
  assert.match(loader, /await Api\.adminApprovedRegs\(tournamentId\)/);
  assert.match(retry, /if \(resultBusy \|\| approvedRegistrationsRequestId\.current === requestId\) return/);
  assert.match(retry, /expandedAction\?\.kind !== 'results' \|\| expandedAction\.tournamentId !== tournamentId/);
  assert.match(retry, /loadApprovedRegistrations\(tournamentId, requestId, true\)/);
  assert.doesNotMatch(retry, /setExpandedAction|Api\.tournaments\(|load\(\)/);
});

test('inline approved-player retry recovers on success and can be retried after another failure', () => {
  const loaderStart = screenSource.indexOf('const loadApprovedRegistrations = async');
  const loaderEnd = screenSource.indexOf('\n  const retryApprovedRegistrations', loaderStart);
  const loader = screenSource.slice(loaderStart, loaderEnd);
  const resultEntryStart = screenSource.indexOf('{resultRegs === null ?');
  const playerChoicesStart = screenSource.indexOf('<Text style={st.lbl}>SELECT PLAYER', resultEntryStart);
  const resultEntryState = screenSource.slice(resultEntryStart, playerChoicesStart);

  assert.match(loader, /setResultRegs\(registrations\)/, 'A successful retry must use the returned approved players.');
  assert.match(
    loader,
    /catch \(e: any\) \{\s*if \(actionRequestId\.current === requestId\) \{\s*setResultError\(apiError\(e\)\);\s*setResultRegs\(null\);/,
    'A repeated failure must retain the error and failed-load state.',
  );
  assert.match(loader, /setResultBusy\(false\);[\s\S]*setRetryingApprovedRegistrations\(false\)/);
  assert.match(resultEntryState, /!resultBusy \|\| retryingApprovedRegistrations/);
  assert.match(resultEntryState, /title=\{retryingApprovedRegistrations \? 'RETRYING…' : 'RETRY APPROVED PLAYERS'\}/);
  assert.match(resultEntryState, /loading=\{retryingApprovedRegistrations\}/);
  assert.match(resultEntryState, /accessibilityState=\{\{ disabled: resultBusy, busy: retryingApprovedRegistrations \}\}/);
  assert.match(resultEntryState, /onPress=\{\(\) => \{ retryApprovedRegistrations\(t\.id\); \}\}/);
});

test('room save and removal outcomes announce once without moving focus', () => {
  const roomStatusMessages = screenSource.match(
    /<Msg kind="(?:err|ok)" text=\{room(?:Error|Success)\} accessibilityLiveRegion="polite" \/>/g,
  ) ?? [];
  assert.equal(roomStatusMessages.length, 2, 'Room errors and successes must each have one polite live region.');

  const saveStart = screenSource.indexOf('const saveRoom = async');
  const clearStart = screenSource.indexOf('const clearRoom = async', saveStart);
  const publishStart = screenSource.indexOf('const publishResult = async', clearStart);
  assert.ok(saveStart >= 0 && clearStart > saveStart && publishStart > clearStart);
  const saveRoomMethod = screenSource.slice(saveStart, clearStart);
  const clearRoomMethod = screenSource.slice(clearStart, publishStart);

  assert.match(saveRoomMethod, /await Api\.adminSaveRoom\(tournamentId, roomForm\)/);
  assert.match(saveRoomMethod, /setRoomSuccess\('Room credentials saved\./);
  assert.match(saveRoomMethod, /setRoomError\(apiError\(e\)\)/);
  assert.match(clearRoomMethod, /await Api\.adminClearRoom\(tournamentId\)/);
  assert.match(clearRoomMethod, /setRoomSuccess\('Room details removed and hidden from players\.'\)/);
  assert.match(clearRoomMethod, /setRoomError\(apiError\(e\)\)/);
  assert.doesNotMatch(`${saveRoomMethod}\n${clearRoomMethod}`, /setAccessibilityFocus|\.focus\(/);
  assert.match(uiSource, /if \(!text\) return null;/);
});

test('tournament and room-management errors use polite live regions', () => {
  assert.match(
    screenSource,
    /<Msg kind="err" text=\{err\} accessibilityLiveRegion="polite" \/>/,
    'Tournament create, update, and delete errors must be announced.',
  );
  assert.match(
    screenSource,
    /<Msg\s+kind="err"\s+text=\{loadError\}\s+accessibilityLiveRegion="polite"\s+testID="admin-tournament-load-error"\s*\/>/,
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

test('the standalone Results screen shows a polite list-load error and lets admins retry', () => {
  const listLoader = resultsSource.match(
    /const loadTournaments = useCallback\(async \(isRetry = false\) => \{[\s\S]*?\n  \}, \[\]\);/,
  )?.[0];
  assert.ok(listLoader, 'The tournament list must have a reusable loader for initial load and retry.');
  assert.match(listLoader, /await Api\.tournaments\(\)/);
  assert.match(listLoader, /setListLoadError\(''\)/);
  assert.match(listLoader, /setListLoadError\('Could not load tournaments\. Please try again\.'\)/);
  assert.match(listLoader, /setHasListLoadFailed\(true\)/);
  assert.doesNotMatch(listLoader, /setList\(\[\]\)/, 'A failed request must not look like a successful empty list.');
  assert.match(listLoader, /setListStatusMessage\(isRetry \? 'Retrying tournaments…' : ''\)/);
  assert.match(listLoader, /setListStatusMessage\(isRetry && tournaments\.length > 0 \? 'Tournament list loaded\.' : ''\)/);
  assert.match(listLoader, /setListStatusMessage\(''\)/);

  assert.match(
    resultsSource,
    /<Msg kind="err" text=\{listLoadError\} accessibilityLiveRegion="polite" \/>/,
    'The tournament-list failure must be announced through the shared polite message component.',
  );
  assert.match(resultsSource, /title="RETRY TOURNAMENTS"/);
  assert.match(resultsSource, /accessibilityLabel="Retry tournaments"/);
  assert.match(resultsSource, /accessibilityHint="Attempts to load the tournament list again\."/);
  assert.match(resultsSource, /accessibilityState=\{\{ busy: listLoading \}\}/);
  assert.match(resultsSource, /loading=\{listLoading\}\s+preserveAccessibilityFocusWhileLoading/);
  assert.match(
    resultsSource,
    /listLoading && !hasListLoadFailed \? <Loading accessibilityLabel="Loading tournaments" \/>/,
    'After the initial failure, keep the retry button mounted while retrying so TalkBack retains a usable focus target.',
  );
  assert.match(resultsSource, /testID="admin-results-retry-tournaments"/);
  assert.match(resultsSource, /onPress=\{retryTournaments\}/);
  assert.match(resultsSource, /const retryTournaments = \(\) => \{\s*if \(listLoading\) return;\s*void loadTournaments\(true\);/);
  assert.match(
    resultsSource,
    /<Text accessibilityLiveRegion="polite" testID="admin-results-list-status">\s*\{listStatusMessage\}\s*<\/Text>/,
    'Retry progress and recovery outcomes must be announced once through a stable polite live region.',
  );
});

test('the standalone Results screen shows an accessible empty state only after a successful empty response', () => {
  const listLoader = resultsSource.match(
    /const loadTournaments = useCallback\(async \(isRetry = false\) => \{[\s\S]*?\n  \}, \[\]\);/,
  )?.[0];
  assert.ok(listLoader, 'The tournament loader must distinguish successful empty data from request failure.');
  assert.match(listLoader, /const tournaments = await Api\.tournaments\(\)/);
  assert.match(listLoader, /setList\(tournaments\)/);
  assert.match(listLoader, /catch \{[\s\S]*setListLoadError\('Could not load tournaments\. Please try again\.'\)/);
  assert.doesNotMatch(listLoader, /catch \{[\s\S]*setList\(\[\]\)/);

  assert.match(
    resultsSource,
    /<Msg kind="err" text=\{listLoadError\} accessibilityLiveRegion="polite" \/>[\s\S]*?\{!list \?[\s\S]*?listLoading && !hasListLoadFailed \? <Loading accessibilityLabel="Loading tournaments" \/>/,
    'Failed requests must stay on the retryable error path rather than showing the empty state.',
  );
  assert.match(
    resultsSource,
    /\) : !sel \? list\.length === 0 \? \(\s*<Empty\s+title="NO TOURNAMENTS TO SHOW"\s+text="There are no tournaments available for results\."\s+accessibilityLabel="No tournaments are available for results\."\s+accessibilityLiveRegion="polite"\s*\/>\s*\)/,
    'A successful empty response must show a clear, accessible no-tournaments state.',
  );
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
  assert.match(catchBody, /Could not confirm whether the result for \$\{playerLabel\} was saved/);
  assert.doesNotMatch(catchBody, /Api\.adminPublishResult/);
});

test('a failed result-log refresh leaves the result unconfirmed and the player available for recovery', () => {
  const publishMethod = screenSource.slice(
    screenSource.indexOf('const publishResult = async'),
    screenSource.indexOf('\n  useEffect(() => { load(); }, [load]);'),
  );
  const catchBody = publishMethod.match(/} catch \(e: any\) \{([\s\S]*?)\n    } finally/)?.[1];
  assert.ok(catchBody, 'The publish flow must handle and recover from submission errors.');

  const refreshFailureStart = catchBody.indexOf('if (refreshedResults.isError)');
  const savedResultLookup = catchBody.indexOf('const savedResult = refreshedResults.data');
  assert.ok(refreshFailureStart >= 0, 'A failed refresh must keep the result status unconfirmed.');
  assert.ok(
    savedResultLookup > refreshFailureStart,
    'Cached result rows must not be treated as confirmed after a failed refresh.',
  );
  const refreshFailureBranch = catchBody.slice(refreshFailureStart, savedResultLookup);
  assert.match(refreshFailureBranch, /Could not confirm whether the result for \$\{playerLabel\} was saved/);
  assert.match(
    refreshFailureBranch,
    /Keep this player selected and retry this result later\. A saved result will be recovered without a second payout/,
  );
  assert.doesNotMatch(
    refreshFailureBranch,
    /setPublishedRegistrationIds|setSelectedRegistrationId\(''\)|setResultRank\('1'\)|setResultKills\(''\)/,
    'An unconfirmed result must stay selected and available for later recovery.',
  );
  assert.match(
    screenSource,
    /<Msg kind="err" text=\{resultError\} accessibilityLiveRegion="polite" \/>/,
    'The unconfirmed status must be announced to the admin.',
  );
});

test('saved placement and winner recovery each announce once without republishing', () => {
  const publishMethod = screenSource.slice(
    screenSource.indexOf('const publishResult = async'),
    screenSource.indexOf('\n  useEffect(() => { load(); }, [load]);'),
  );
  const catchBody = publishMethod.match(/} catch \(e: any\) \{([\s\S]*?)\n    } finally/)?.[1];
  assert.ok(catchBody, 'The publish flow must recover from a lost or duplicate response.');

  const branches = catchBody.match(
    /if \(savedRank === 1\) \{([\s\S]*?)\n          } else \{([\s\S]*?)\n          }\n          return;/,
  );
  assert.ok(branches, 'Saved winners and placements must use separate recovery behavior.');
  const winnerRecovery = branches[1];
  const placementRecovery = branches[2];

  assert.equal(
    (winnerRecovery.match(/setOkMsg\(recoveredMessage\)/g) ?? []).length,
    1,
    'A saved winner should publish one recovery announcement.',
  );
  assert.match(winnerRecovery, /await load\(\)/);
  assert.match(winnerRecovery, /setTab\('completed'\)/);
  assert.equal(
    (placementRecovery.match(/setResultSuccess\(recoveredMessage\)/g) ?? []).length,
    1,
    'A saved placement should publish one recovery announcement.',
  );
  for (const branch of [winnerRecovery, placementRecovery]) {
    assert.doesNotMatch(branch, /Api\.adminPublishResult/, 'Recovery must not submit another payout.');
  }
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