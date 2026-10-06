import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  HOME_GAME_MODE_CARDS,
  homeModeRouteParams,
  submodeRouteParams,
  tournamentListEmptyMessage,
  tournamentTabsForRoute,
} from '../src/lib/tournamentFilters.ts';
import { createLatestRequestGuard } from '../src/lib/latestRequestGuard.ts';
import { getRoomCredentialSchedule } from '../src/lib/roomCredentialTiming.ts';
import {
  getTournamentLifecycleState,
  MAX_TIMEOUT_MS,
} from '../src/lib/tournamentLifecycle.ts';

const homeSource = await readFile(
  new URL('../src/screens/Home.tsx', import.meta.url),
  'utf8',
);
const modeSubmodesSource = await readFile(
  new URL('../src/screens/ModeSubmodes.tsx', import.meta.url),
  'utf8',
);
const detailSource = await readFile(
  new URL('../src/screens/TDetail.tsx', import.meta.url),
  'utf8',
);
const tournamentsSource = await readFile(
  new URL('../src/screens/Tournaments.tsx', import.meta.url),
  'utf8',
);
const tournamentsSourceFile = ts.createSourceFile(
  'Tournaments.tsx',
  tournamentsSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const appSource = await readFile(
  new URL('../src/App.tsx', import.meta.url),
  'utf8',
);

function loadLifecycleRefreshEffect(scope) {
  let effectCallback = null;

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && node.expression.getText(tournamentsSourceFile) === 'useEffect'
      && ts.isArrowFunction(node.arguments[0])
      && node.arguments[0].body.getText(tournamentsSourceFile).includes('const transitions = items.flatMap')
    ) {
      effectCallback = node.arguments[0];
    }
    ts.forEachChild(node, visit);
  }

  visit(tournamentsSourceFile);
  assert.ok(effectCallback, 'the screen lifecycle-boundary effect should be present');

  const javascript = ts.transpileModule(
    `const __effect = (${effectCallback.getText(tournamentsSourceFile)});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __effect;`,
  )(...Object.values(scope));
}

test('Solo, Duo, and Squad selections keep the selected game mode in their route params', () => {
  for (const teamType of ['solo', 'duo', 'squad']) {
    assert.deepEqual(
      submodeRouteParams('clash_squad', teamType, 'CLASH SQUAD'),
      {
        gameMode: 'clash_squad',
        teamType,
        gameModeLabel: 'CLASH SQUAD',
      },
    );
  }

  assert.match(modeSubmodesSource, /\{ type: 'duo', title: 'DUO'/);
  assert.match(
    modeSubmodesSource,
    /navigation\.navigate\(\s*'Tournaments',\s*submodeRouteParams\(gameMode,\s*format\.type,\s*mode\.title\),/,
  );
});

test('Home mode cards show every team type while the format picker stays restricted', () => {
  const tournaments = HOME_GAME_MODE_CARDS.flatMap(({ gameMode }) =>
    ['Solo', 'Duo', 'Squad'].map((teamType) => ({
      id: `${gameMode}-${teamType.toLowerCase()}`,
      gameMode,
      teamType,
    })),
  );

  assert.match(
    homeSource,
    /onPress=\{\(\) => nav\.navigate\('Tournaments', homeModeRouteParams\(m\)\)\}/,
  );
  assert.match(
    homeSource,
    /onPress=\{\(\) => nav\.navigate\('ModeSubmodes', homeModeRouteParams\(m\)\)\}/,
  );
  assert.match(
    modeSubmodesSource,
    /navigation\.navigate\(\s*'Tournaments',\s*submodeRouteParams\(gameMode,\s*format\.type,\s*mode\.title\),/,
  );

  for (const card of HOME_GAME_MODE_CARDS) {
    const directParams = homeModeRouteParams(card);
    assert.deepEqual(directParams, {
      gameMode: card.gameMode,
      gameModeLabel: card.mode,
    });
    assert.equal(Object.hasOwn(directParams, 'teamType'), false);

    const directTabs = tournamentTabsForRoute(
      tournaments,
      directParams,
      () => 'upcoming',
    );
    assert.deepEqual(
      directTabs.upcoming.map((tournament) => tournament.id),
      ['solo', 'duo', 'squad'].map((teamType) => `${card.gameMode}-${teamType}`),
    );

    for (const teamType of ['solo', 'duo', 'squad']) {
      const pickerParams = submodeRouteParams(card.gameMode, teamType, card.mode);
      assert.deepEqual(pickerParams, {
        gameMode: card.gameMode,
        teamType,
        gameModeLabel: card.mode,
      });
      const pickerTabs = tournamentTabsForRoute(
        tournaments,
        pickerParams,
        () => 'upcoming',
      );
      assert.deepEqual(
        pickerTabs.upcoming.map((tournament) => tournament.id),
        [`${card.gameMode}-${teamType}`],
      );
    }
  }
});

test('the tournament screen applies both route mode and team type filters', () => {
  assert.match(tournamentsSource, /const gameMode = route\?\.params\?\.gameMode/);
  assert.match(tournamentsSource, /const teamType = route\?\.params\?\.teamType/);
  assert.match(
    tournamentsSource,
    /tournamentTabsForRoute\(items,\s*\{\s*gameMode:\s*gameMode\s*\|\|\s*legacyMode,\s*teamType,\s*\},\s*lifecycleOf\)/,
  );
});

test('focus, pull-to-refresh, and app resume reuse the mode-scoped screen data', () => {
  const loadStart = tournamentsSource.indexOf('const load = useCallback(async () => {');
  const loadEnd = tournamentsSource.indexOf('}, []);', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'the tournament loader should be present');
  assert.doesNotMatch(
    tournamentsSource.slice(loadStart, loadEnd),
    /setTab\s*\(/,
    'refreshing data should not reset the selected lifecycle tab',
  );
  assert.match(
    tournamentsSource,
    /useFocusEffect\(useCallback\(\(\) => \{ void load\(\); \}, \[load\]\)\)/,
  );
  assert.match(
    tournamentsSource,
    /const returnedToApp = appState\.current !== 'active' && nextState === 'active';\s*appState\.current = nextState;\s*if \(returnedToApp\) \{\s*setClockNow\(Date\.now\(\)\);\s*void load\(\);\s*\}/,
  );
  assert.match(
    tournamentsSource,
    /const onRefresh = async \(\) => \{ setRefreshing\(true\); await load\(\); setRefreshing\(false\); \};/,
  );
  assert.match(
    tournamentsSource,
    /setItems\(\(Array\.isArray\(list\) \? list : \[\]\)\.map/,
  );
  assert.match(tournamentsSource, /const loadRequests = useRef\(createLatestRequestGuard\(\)\)/);
  assert.match(tournamentsSource, /const request = loadRequests\.current\.begin\(\)/);
  assert.match(tournamentsSource, /if \(!loadRequests\.current\.isCurrent\(request\)\) return;/);
  assert.match(
    tournamentsSource,
    /const modeScopedTabs = tournamentTabsForRoute\(items,\s*\{\s*gameMode:\s*gameMode \|\| legacyMode,\s*teamType,\s*\},\s*lifecycleOf\)/,
  );
  assert.match(tournamentsSource, /const visible = modeScopedTabs\[tab\]/);
  assert.match(tournamentsSource, /const count = modeScopedTabs\[value\]\.length/);
  assert.match(
    tournamentsSource,
    /accessibilityLabel=\{`\$\{tabLabel\[value\]\} tournaments, \$\{count\}`\}/,
  );
  assert.match(tournamentsSource, /data=\{orderedVisible\}/);
  assert.match(
    tournamentsSource,
    /ListEmptyComponent=\{<Empty text=\{tournamentListEmptyMessage\(/,
  );
});

test('a match crossing its start time updates selected-mode tabs and counts automatically', () => {
  const startAtMs = Date.parse('2026-10-06T14:00:00.000Z');
  const startsAt = new Date(startAtMs).toISOString();
  const selectedMode = 'clash_squad';
  const items = [
    { id: 'clash-starting', gameMode: selectedMode, startsAt },
    { id: 'battle-starting', gameMode: 'battle_royale', startsAt },
  ];
  let fakeNow = startAtMs - 1_000;
  let clockNow = fakeNow;
  let loadCalls = 0;
  const timers = [];
  const clearedTimers = [];
  const lifecycleEffect = loadLifecycleRefreshEffect({
    items,
    getRoomCredentialSchedule,
    MAX_TIMEOUT_MS,
    Date: { now: () => fakeNow },
    setTimeout: (callback, delayMs) => {
      const timer = { callback, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => clearedTimers.push(timer),
    setClockNow: (value) => { clockNow = value; },
    load: () => { loadCalls += 1; },
  });

  const cleanup = lifecycleEffect();
  assert.equal(timers.length, 1, 'the screen should schedule a timer for the nearest start');
  assert.equal(timers[0].delayMs, 1_020, 'the refresh should run just after the scheduled start');

  fakeNow = startAtMs + 20;
  timers[0].callback();
  assert.equal(clockNow, fakeNow, 'the timer should advance the screen lifecycle clock');
  assert.equal(loadCalls, 1, 'the timer should reload tournament data without manual refresh');

  const tabsAt = (now) => tournamentTabsForRoute(
    items,
    { gameMode: selectedMode },
    (tournament) => getTournamentLifecycleState(tournament, now),
  );
  const beforeTabs = tabsAt(startAtMs - 1);
  const afterTabs = tabsAt(clockNow);
  const counts = (tabs) => Object.fromEntries(
    Object.entries(tabs).map(([name, tournaments]) => [name, tournaments.length]),
  );

  assert.deepEqual(beforeTabs.upcoming.map((tournament) => tournament.id), ['clash-starting']);
  assert.deepEqual(beforeTabs.ongoing, []);
  assert.deepEqual(counts(beforeTabs), { upcoming: 1, ongoing: 0, completed: 0 });
  assert.deepEqual(afterTabs.upcoming, []);
  assert.deepEqual(afterTabs.ongoing.map((tournament) => tournament.id), ['clash-starting']);
  assert.deepEqual(counts(afterTabs), { upcoming: 0, ongoing: 1, completed: 0 });
  for (const tabs of [beforeTabs, afterTabs]) {
    assert.ok(
      Object.values(tabs).flat().every((tournament) => tournament.gameMode === selectedMode),
      'another game mode must not appear in any selected-mode tab',
    );
  }

  cleanup();
  assert.deepEqual(clearedTimers, [timers[0]]);
});

test('a slower earlier load cannot replace newer rows or tab counts', async () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
  };
  const requests = createLatestRequestGuard();
  const olderResponse = deferred();
  const newerResponse = deferred();
  const selectedMode = 'clash_squad';
  const selectedTab = 'ongoing';
  let rows = [];

  const load = async (response) => {
    const request = requests.begin();
    const result = await response;
    if (requests.isCurrent(request)) rows = result;
  };

  const olderLoad = load(olderResponse.promise);
  const newerLoad = load(newerResponse.promise);

  newerResponse.resolve([
    { id: 'fresh-upcoming', gameMode: selectedMode, lifecycle: 'upcoming' },
    { id: 'fresh-ongoing', gameMode: selectedMode, lifecycle: 'ongoing' },
    { id: 'other-mode-completed', gameMode: 'battle_royale', lifecycle: 'completed' },
  ]);
  await newerLoad;

  olderResponse.resolve([
    { id: 'stale-upcoming', gameMode: selectedMode, lifecycle: 'upcoming' },
    { id: 'stale-completed', gameMode: selectedMode, lifecycle: 'completed' },
  ]);
  await olderLoad;

  const tabs = tournamentTabsForRoute(
    rows,
    { gameMode: selectedMode },
    (tournament) => tournament.lifecycle,
  );
  assert.deepEqual(tabs.upcoming.map((item) => item.id), ['fresh-upcoming']);
  assert.deepEqual(tabs.ongoing.map((item) => item.id), ['fresh-ongoing']);
  assert.deepEqual(tabs.completed, []);
  assert.deepEqual(
    Object.fromEntries(Object.entries(tabs).map(([name, tournaments]) => [name, tournaments.length])),
    { upcoming: 1, ongoing: 1, completed: 0 },
  );
  assert.equal(tabs[selectedTab][0].id, 'fresh-ongoing');
  assert.ok(
    Object.values(tabs).flat().every((tournament) => tournament.gameMode === selectedMode),
    'the selected game mode remains applied after both requests settle',
  );
  assert.equal(selectedTab, 'ongoing');
});

test('opening a tournament pushes its detail above the filtered list for Android Back', () => {
  assert.match(
    tournamentsSource,
    /onPress=\{\(\) => nav\.push\('TDetail', \{ id: item\.id \}\)\}/,
  );
  assert.match(
    tournamentsSource,
    /const heading = route\?\.params\?\.gameModeLabel \|\| legacyMode \|\| gameMode/,
  );
  assert.match(
    appSource,
    /<Stack\.Screen name="Tournaments" component=\{Tournaments\}[^>]*\/>[\s\S]*<Stack\.Screen name="TDetail" component=\{TDetail\}/,
  );
});

test('Home tournament shortcuts push the selected detail above Home', () => {
  assert.match(
    homeSource,
    /const openTournamentDetail = \(id: string\) => nav\.getParent\(\)\.push\('TDetail', \{ id \}\);/,
  );
  assert.equal(
    [...homeSource.matchAll(/onPress=\{\(\) => openTournamentDetail\(t\.id\)\}/g)].length,
    2,
    'both the upcoming card and its action should open the selected tournament',
  );
  assert.match(detailSource, /const id = route\?\.params\?\.id;/);
  assert.match(
    detailSource,
    /const load = useCallback\(async \(\) => \{[\s\S]*api\.tournament\(id\)[\s\S]*\}, \[id\]\);/,
    'the detail reloads data for the ID in its own route params',
  );
  assert.match(
    appSource,
    /<Stack\.Screen name="Tabs" component=\{Tabs\}[^>]*\/>[\s\S]*<Stack\.Screen name="TDetail" component=\{TDetail\}/,
    'the pushed detail sits above the preserved Tabs/Home screen for Android Back',
  );
});

test('a pushed detail can return to the same mode heading and tournament list', () => {
  const modes = [
    { gameMode: 'battle_royale', label: 'Battle Royale' },
    { gameMode: 'clash_squad', label: 'Clash Squad' },
    { gameMode: 'lone_wolf', label: 'Lone Wolf' },
  ];
  const tournaments = modes.map(({ gameMode }) => ({
    id: `${gameMode}-tournament`,
    gameMode,
  }));

  for (const { gameMode, label } of modes) {
    const routeParams = homeModeRouteParams({ gameMode, mode: label });
    const tabs = tournamentTabsForRoute(
      tournaments,
      { gameMode: routeParams.gameMode },
      () => 'upcoming',
    );

    assert.equal(routeParams.gameModeLabel, label);
    assert.deepEqual(
      tabs.upcoming.map((tournament) => tournament.id),
      [`${gameMode}-tournament`],
    );
  }
});

test('Solo, Duo, and Squad lists exclude other sizes without losing the selected mode', () => {
  const tournaments = HOME_GAME_MODE_CARDS.flatMap(({ gameMode }) =>
    ['Solo', 'Duo', 'Squad'].map((teamType) => ({
      id: `${gameMode}-${teamType.toLowerCase()}`,
      gameMode,
      teamType,
    })),
  );
  const lifecycleOf = () => 'upcoming';

  for (const [teamType, expectedId] of [
    ['solo', 'clash_squad-solo'],
    ['duo', 'clash_squad-duo'],
    ['squad', 'clash_squad-squad'],
  ]) {
    const tabs = tournamentTabsForRoute(
      tournaments,
      { gameMode: 'clash_squad', teamType },
      lifecycleOf,
    );

    assert.deepEqual(
      tabs.upcoming.map((tournament) => tournament.id),
      [expectedId],
    );
    assert.deepEqual(tabs.ongoing, []);
    assert.deepEqual(tabs.completed, []);
  }
});

test('empty format-filtered lifecycle tabs name the selected mode and team size without leaking other tournaments', () => {
  const selectedTournaments = [
    { id: 'clash-duo-upcoming', gameMode: 'clash_squad', teamType: 'Duo', lifecycle: 'upcoming' },
    { id: 'clash-duo-ongoing', gameMode: 'clash_squad', teamType: 'Duo', lifecycle: 'ongoing' },
    { id: 'clash-duo-completed', gameMode: 'clash_squad', teamType: 'Duo', lifecycle: 'completed' },
  ];
  const otherTournaments = [
    { id: 'battle-duo-upcoming', gameMode: 'battle_royale', teamType: 'Duo', lifecycle: 'upcoming' },
    { id: 'clash-solo-ongoing', gameMode: 'clash_squad', teamType: 'Solo', lifecycle: 'ongoing' },
    { id: 'clash-squad-completed', gameMode: 'clash_squad', teamType: 'Squad', lifecycle: 'completed' },
    { id: 'wolf-duo-completed', gameMode: 'lone_wolf', teamType: 'Duo', lifecycle: 'completed' },
  ];
  const filters = { gameMode: 'clash_squad', teamType: 'duo' };
  const lifecycleOf = (tournament) => tournament.lifecycle;
  const allTabs = tournamentTabsForRoute(
    [...selectedTournaments, ...otherTournaments],
    filters,
    lifecycleOf,
  );

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(allTabs).map(([tab, tournaments]) => [
        tab,
        tournaments.map((tournament) => tournament.id),
      ]),
    ),
    {
      upcoming: ['clash-duo-upcoming'],
      ongoing: ['clash-duo-ongoing'],
      completed: ['clash-duo-completed'],
    },
  );

  const lifecycleLabels = {
    upcoming: 'Upcoming',
    ongoing: 'Ongoing',
    completed: 'Completed',
  };
  for (const [tab, label] of Object.entries(lifecycleLabels)) {
    const scenarioTabs = tournamentTabsForRoute(
      [
        ...selectedTournaments.filter((tournament) => tournament.lifecycle !== tab),
        ...otherTournaments,
      ],
      filters,
      lifecycleOf,
    );
    assert.deepEqual(scenarioTabs[tab], [], `${label} should be empty when this mode and format have no matches`);
    assert.equal(
      tournamentListEmptyMessage(false, label, 'CLASH SQUAD', 'duo'),
      `No ${tab} Duo Clash Squad tournaments are available right now.`,
    );
  }

  assert.match(
    tournamentsSource,
    /tournamentListEmptyMessage\(Boolean\(error\),\s*tabLabel\[tab\],\s*heading,\s*teamType\)/,
  );
  assert.equal(
    tournamentListEmptyMessage(true, 'Completed', 'CLASH SQUAD', 'duo'),
    'Tournament data is unavailable right now. Pull to refresh and try again.',
  );
});