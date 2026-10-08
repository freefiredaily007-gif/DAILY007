import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  CommonActions,
  StackActions,
  StackRouter,
  TabRouter,
} from '@react-navigation/routers';
import {
  HOME_GAME_MODE_CARDS,
  homeModeRouteParams,
  submodeRouteParams,
  tournamentListEmptyMessage,
  tournamentTabsForRoute,
} from '../src/lib/tournamentFilters.ts';
import { createLatestRequestGuard } from '../src/lib/latestRequestGuard.ts';
import { getRoomCredentialSchedule } from '../src/lib/roomCredentialTiming.ts';
import { fetchTournamentDetailSnapshot } from '../src/lib/tournament-detail-refresh.ts';
import {
  getTournamentLifecycleState,
  MAX_COMPLETED_TOURNAMENTS,
  MAX_TIMEOUT_MS,
  mostRecentCompletedTournaments,
} from '../src/lib/tournamentLifecycle.ts';
import { takeTournamentStartAnnouncement } from '../src/lib/tournamentStartAnnouncement.ts';

const homeSource = await readFile(
  new URL('../src/screens/Home.tsx', import.meta.url),
  'utf8',
);
const homeSourceFile = ts.createSourceFile(
  'Home.tsx',
  homeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const modeSubmodesSource = await readFile(
  new URL('../src/screens/ModeSubmodes.tsx', import.meta.url),
  'utf8',
);
const uiSource = await readFile(
  new URL('../src/components/ui.tsx', import.meta.url),
  'utf8',
);
const detailSource = await readFile(
  new URL('../src/screens/TDetail.tsx', import.meta.url),
  'utf8',
);
const detailSourceFile = ts.createSourceFile(
  'TDetail.tsx',
  detailSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
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

function findVariableInitializer(sourceFile, variableName) {
  let initializer;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === variableName
    ) {
      initializer = node.initializer ?? undefined;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(initializer, `the ${variableName} initializer should be present`);
  return initializer;
}

function evaluateTypeScriptExpression(expression, sourceFile, scope = {}) {
  const javascript = ts.transpileModule(
    `const __runtimeValue = (${expression.getText(sourceFile)});`,
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;

  return new Function(
    ...Object.keys(scope),
    `${javascript}\nreturn __runtimeValue;`,
  )(...Object.values(scope));
}

function createTournamentLoadHarness(api) {
  const state = {
    items: [],
    error: '',
    registrationError: '',
    loading: true,
    clockNow: 0,
    playerLoadAnnouncement: '',
  };
  const screen = { selectedTab: 'upcoming' };
  const refs = {
    loadRequests: { current: createLatestRequestGuard() },
    hasLoadedList: { current: false },
    initialLoadFailed: { current: false },
  };
  const load = evaluateTypeScriptExpression(
    findVariableInitializer(tournamentsSourceFile, 'load'),
    tournamentsSourceFile,
    {
      useCallback: (callback) => callback,
      api,
      apiError: (error) => error instanceof Error ? error.message : String(error),
      loadRequests: refs.loadRequests,
      hasLoadedList: refs.hasLoadedList,
      initialLoadFailed: refs.initialLoadFailed,
      setItems: (nextItems) => {
        state.items = typeof nextItems === 'function' ? nextItems(state.items) : nextItems;
      },
      setError: (error) => { state.error = error; },
      setRegistrationError: (error) => { state.registrationError = error; },
      setLoading: (loading) => { state.loading = loading; },
      setClockNow: (clockNow) => { state.clockNow = clockNow; },
      setPlayerLoadAnnouncement: (announcement) => { state.playerLoadAnnouncement = announcement; },
      setTab: (selectedTab) => { screen.selectedTab = selectedTab; },
    },
  );
  return { load, refs, screen, state };
}

function findDetailTitleExpression() {
  let titleExpression;

  function visit(node) {
    if (
      ts.isJsxElement(node)
      && node.openingElement.tagName.getText(detailSourceFile) === 'Text'
    ) {
      const isTournamentName = node.openingElement.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute)
          && attribute.name.getText(detailSourceFile) === 'style'
          && ts.isJsxExpression(attribute.initializer)
          && attribute.initializer.expression?.getText(detailSourceFile) === 's.name',
      );
      const titleChild = node.children.find(
        (child) => ts.isJsxExpression(child) && child.expression,
      );
      if (isTournamentName && titleChild && ts.isJsxExpression(titleChild)) {
        titleExpression = titleChild.expression;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(detailSourceFile);
  assert.ok(titleExpression, 'the tournament-name Text expression should be present');
  return titleExpression;
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

test('format cards announce one mode, format, and capacity action without decorative focus stops', () => {
  assert.match(
    modeSubmodesSource,
    /accessibilityGroup\s+accessibilityLabel=\{`\$\{mode\.title\}, \$\{format\.title\}, \$\{capacity\.label\}`\}/,
  );
  assert.match(
    modeSubmodesSource,
    /accessibilityHint="Opens available tournaments for this format"/,
  );
  assert.match(uiSource, /accessible=\{accessibilityGroup \? true : undefined\}/);
  assert.match(uiSource, /accessible=\{accessibilityGroup \? false : undefined\}/);
  assert.match(uiSource, /accessibilityElementsHidden=\{accessibilityGroup\}/);
  assert.match(uiSource, /importantForAccessibility=\{accessibilityGroup \? 'no-hide-descendants' : undefined\}/);

  const tournaments = HOME_GAME_MODE_CARDS.flatMap(({ gameMode }) =>
    ['Solo', 'Duo', 'Squad'].map((teamType) => ({
      id: `${gameMode}-${teamType.toLowerCase()}`,
      gameMode,
      teamType,
    })),
  );
  for (const mode of HOME_GAME_MODE_CARDS) {
    for (const teamType of ['solo', 'duo', 'squad']) {
      const routeParams = submodeRouteParams(mode.gameMode, teamType, mode.mode);
      assert.deepEqual(routeParams, {
        gameMode: mode.gameMode,
        teamType,
        gameModeLabel: mode.mode,
      });
      assert.deepEqual(
        tournamentTabsForRoute(tournaments, routeParams, () => 'upcoming').upcoming
          .map((tournament) => tournament.id),
        [`${mode.gameMode}-${teamType}`],
      );
    }
  }
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
    /useFocusEffect\(useCallback\(\(\) => \{\s*listFocused\.current = true;\s*void load\(\);\s*return \(\) => \{ listFocused\.current = false; \};\s*\}, \[load\]\)\)/,
  );
  assert.match(
    tournamentsSource,
    /const returnedToApp = appState\.current !== 'active' && nextState === 'active';\s*appState\.current = nextState;\s*if \(returnedToApp\) \{\s*setClockNow\(Date\.now\(\)\);\s*void load\(\);\s*\}/,
  );
  assert.match(
    tournamentsSource,
    /const onRefresh = async \(\) => \{\s*if \(refreshingRequest\.current\) return;\s*refreshingRequest\.current = true;\s*setRefreshing\(true\);\s*try \{\s*await load\(\);\s*\} finally \{\s*refreshingRequest\.current = false;\s*setRefreshing\(false\);\s*\}\s*\};/,
  );
  assert.match(
    tournamentsSource,
    /setItems\(\(Array\.isArray\(listResult\.value\) \? listResult\.value : \[\]\)\.map/,
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
    /accessibilityLabel=\{`\$\{tabLabel\[value\]\} tournaments, \$\{displayedCount\}`\}/,
  );
  assert.match(tournamentsSource, /data=\{orderedVisible\}/);
  assert.match(
    tournamentsSource,
    /ListEmptyComponent=\{error \? null : \(\s*<Empty text=\{emptyMessage\} accessibilityLabel=\{emptyMessage\} \/>\s*\)\}/,
  );
});

test('failed tournament refreshes preserve the last complete rows and successful retry clears the error', async () => {
  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const route = { gameMode: 'clash_squad', teamType: 'duo' };
  const initialTournaments = [
    { id: 'last-upcoming', gameMode: 'clash_squad', teamType: 'Duo', status: 'upcoming', startsAt: futureStart },
    { id: 'last-ongoing', gameMode: 'clash_squad', teamType: 'Duo', status: 'ongoing', startsAt: pastStart },
    { id: 'last-completed', gameMode: 'clash_squad', teamType: 'Duo', status: 'completed', startsAt: pastStart },
  ];
  const api = {
    tournaments: async () => initialTournaments,
    myRegistrations: async () => [{ tournamentId: 'last-upcoming', status: 'approved' }],
  };
  const harness = createTournamentLoadHarness(api);
  harness.screen.selectedTab = 'ongoing';

  const getTabs = () => tournamentTabsForRoute(
    harness.state.items,
    route,
    (tournament) => getTournamentLifecycleState(tournament, harness.state.clockNow),
  );
  const getTabCounts = () => Object.fromEntries(
    Object.entries(getTabs()).map(([name, tournaments]) => [name, tournaments.length]),
  );

  await harness.load();
  const lastGoodItems = harness.state.items;
  const lastGoodCounts = getTabCounts();
  assert.deepEqual(lastGoodCounts, { upcoming: 1, ongoing: 1, completed: 1 });
  assert.deepEqual(getTabs()[harness.screen.selectedTab].map((tournament) => tournament.id), ['last-ongoing']);
  assert.equal(lastGoodItems.find((tournament) => tournament.id === 'last-upcoming').joined, true);

  api.tournaments = async () => [
    { id: 'partial-list', gameMode: 'clash_squad', teamType: 'Duo', status: 'upcoming', startsAt: futureStart },
  ];
  api.myRegistrations = async () => { throw new Error('Registration service unavailable'); };
  await harness.load();

  assert.strictEqual(harness.state.items, lastGoodItems, 'a registration failure must not commit a new tournament list');
  assert.deepEqual(getTabCounts(), lastGoodCounts, 'tab counts must remain based on the last complete snapshot');
  assert.deepEqual(getTabs()[harness.screen.selectedTab].map((tournament) => tournament.id), ['last-ongoing']);
  assert.equal(harness.state.error, 'Registration service unavailable');
  assert.equal(harness.state.registrationError, '');
  assert.equal(harness.screen.selectedTab, 'ongoing');
  assert.equal(route.gameMode, 'clash_squad');

  api.tournaments = async () => { throw new Error('Tournament service unavailable'); };
  api.myRegistrations = async () => [{ tournamentId: 'last-completed', status: 'approved' }];
  await harness.load();

  assert.strictEqual(harness.state.items, lastGoodItems, 'a tournament-list failure must not clear previously loaded rows');
  assert.deepEqual(getTabCounts(), lastGoodCounts);
  assert.deepEqual(getTabs()[harness.screen.selectedTab].map((tournament) => tournament.id), ['last-ongoing']);
  assert.equal(harness.state.error, 'Tournament service unavailable');
  assert.equal(harness.screen.selectedTab, 'ongoing');

  api.tournaments = async () => [
    { id: 'fresh-upcoming-one', gameMode: 'clash_squad', teamType: 'Duo', status: 'upcoming', startsAt: futureStart },
    { id: 'fresh-upcoming-two', gameMode: 'clash_squad', teamType: 'Duo', status: 'upcoming', startsAt: futureStart },
    { id: 'fresh-ongoing', gameMode: 'clash_squad', teamType: 'Duo', status: 'ongoing', startsAt: pastStart },
    { id: 'fresh-completed', gameMode: 'clash_squad', teamType: 'Duo', status: 'completed', startsAt: pastStart },
  ];
  api.myRegistrations = async () => [{ tournamentId: 'fresh-ongoing', status: 'pending' }];
  await harness.load();

  assert.notStrictEqual(harness.state.items, lastGoodItems);
  assert.deepEqual(harness.state.items.map((tournament) => tournament.id), [
    'fresh-upcoming-one',
    'fresh-upcoming-two',
    'fresh-ongoing',
    'fresh-completed',
  ]);
  assert.deepEqual(getTabCounts(), { upcoming: 2, ongoing: 1, completed: 1 });
  assert.deepEqual(getTabs()[harness.screen.selectedTab].map((tournament) => tournament.id), ['fresh-ongoing']);
  assert.equal(harness.state.items.find((tournament) => tournament.id === 'fresh-ongoing').joined, true);
  assert.equal(harness.state.error, '');
  assert.equal(harness.state.registrationError, '');
  assert.equal(harness.screen.selectedTab, 'ongoing');
  assert.equal(route.gameMode, 'clash_squad');

  assert.match(
    tournamentsSource,
    /text=\{`\$\{hasLoadedList\.current \? 'Could not refresh' : 'Could not load'\} tournaments:/,
  );
  assert.match(
    tournamentsSource,
    /testID=\{hasLoadedList\.current \? 'player-tournament-refresh-error' : 'player-tournament-load-error'\}/,
  );
});

test('a mode-filtered refresh updates tab accessibility labels and retains selection', async () => {
  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const route = { gameMode: 'clash_squad', teamType: 'duo' };
  const api = {
    tournaments: async () => [
      { id: 'old-upcoming', gameMode: 'clash_squad', teamType: 'Duo', status: 'upcoming', startsAt: futureStart },
      { id: 'old-ongoing', gameMode: 'clash_squad', teamType: 'Duo', status: 'ongoing', startsAt: pastStart },
      { id: 'old-completed', gameMode: 'clash_squad', teamType: 'Duo', status: 'completed', startsAt: pastStart },
    ],
    myRegistrations: async () => [],
  };
  const harness = createTournamentLoadHarness(api);
  harness.screen.selectedTab = 'ongoing';
  await harness.load();

  const completedFixtures = Array.from(
    { length: MAX_COMPLETED_TOURNAMENTS + 2 },
    (_, index) => ({
      id: `fresh-completed-${index + 1}`,
      gameMode: 'clash_squad',
      teamType: 'Duo',
      status: 'completed',
      startsAt: pastStart,
      completedAt: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
    }),
  );
  api.tournaments = async () => [
    { id: 'fresh-upcoming-one', gameMode: 'clash_squad', teamType: 'Duo', status: 'upcoming', startsAt: futureStart },
    { id: 'fresh-upcoming-two', gameMode: 'clash_squad', teamType: 'Duo', status: 'upcoming', startsAt: futureStart },
    { id: 'fresh-ongoing-one', gameMode: 'clash_squad', teamType: 'Duo', status: 'ongoing', startsAt: pastStart },
    { id: 'fresh-ongoing-two', gameMode: 'clash_squad', teamType: 'Duo', status: 'ongoing', startsAt: pastStart },
    ...completedFixtures,
  ];
  await harness.load();

  const tabs = tournamentTabsForRoute(
    harness.state.items,
    route,
    (tournament) => getTournamentLifecycleState(tournament, harness.state.clockNow),
  );
  const counts = Object.fromEntries(
    Object.entries(tabs).map(([tab, tournaments]) => [tab, tournaments.length]),
  );
  const tabLabels = { upcoming: 'Upcoming', ongoing: 'Ongoing', completed: 'Completed' };
  const displayedCounts = Object.fromEntries(
    Object.entries(counts).map(([tab, count]) => [
      tab,
      tab === 'completed' ? Math.min(count, MAX_COMPLETED_TOURNAMENTS) : count,
    ]),
  );
  const visibleCounts = Object.fromEntries(
    Object.entries(tabs).map(([tab, tournaments]) => [
      tab,
      (tab === 'completed' ? mostRecentCompletedTournaments(tournaments) : tournaments).length,
    ]),
  );
  const accessibleLabels = Object.fromEntries(
    Object.entries(displayedCounts).map(([tab, count]) => [tab, `${tabLabels[tab]} tournaments, ${count}`]),
  );
  const accessibleStates = Object.fromEntries(
    Object.keys(counts).map((tab) => [tab, { selected: tab === harness.screen.selectedTab }]),
  );

  assert.deepEqual(counts, { upcoming: 2, ongoing: 2, completed: MAX_COMPLETED_TOURNAMENTS + 2 });
  assert.deepEqual(displayedCounts, { upcoming: 2, ongoing: 2, completed: MAX_COMPLETED_TOURNAMENTS });
  assert.deepEqual(visibleCounts, displayedCounts);
  assert.deepEqual(accessibleLabels, {
    upcoming: 'Upcoming tournaments, 2',
    ongoing: 'Ongoing tournaments, 2',
    completed: `Completed tournaments, ${MAX_COMPLETED_TOURNAMENTS}`,
  });
  assert.deepEqual(accessibleStates, {
    upcoming: { selected: false },
    ongoing: { selected: true },
    completed: { selected: false },
  });
  assert.equal(harness.screen.selectedTab, 'ongoing');
  assert.equal(tabs[harness.screen.selectedTab].length, counts[harness.screen.selectedTab]);
  assert.deepEqual(
    tabs[harness.screen.selectedTab].map((tournament) => tournament.id),
    ['fresh-ongoing-one', 'fresh-ongoing-two'],
  );
  assert.equal(route.gameMode, 'clash_squad');

  assert.match(tournamentsSource, /key=\{value\}\s+testID=\{`tournament-tab-\$\{value\}`\}/);
  assert.match(tournamentsSource, /accessibilityRole="button"/);
  assert.match(tournamentsSource, /accessibilityState=\{\{ selected \}\}/);
  assert.match(
    tournamentsSource,
    /accessibilityLabel=\{`\$\{tabLabel\[value\]\} tournaments, \$\{displayedCount\}`\}/,
  );
  const tabControl = tournamentsSource.match(/<Pressable\s+key=\{value\}[\s\S]*?<\/Pressable>/)?.[0];
  assert.ok(tabControl, 'the lifecycle tab button should be present');
  assert.doesNotMatch(tabControl, /accessibilityLiveRegion/);
  const loadStart = tournamentsSource.indexOf('const load = useCallback(async () => {');
  const loadEnd = tournamentsSource.indexOf('}, []);', loadStart);
  const loadSource = tournamentsSource.slice(loadStart, loadEnd);
  assert.doesNotMatch(
    loadSource,
    /AccessibilityInfo\.announceForAccessibility/,
    'a refresh must not emit a second announcement in addition to the focused tab label',
  );
  assert.match(
    loadSource,
    /if \(recoveredInitialLoad\) setPlayerLoadAnnouncement\('Tournaments loaded\.'\)/,
    'the separate load announcement must remain limited to recovery from the initial load',
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
  let startAnnouncement = '';
  const timers = [];
  const clearedTimers = [];
  const lifecycleEffect = loadLifecycleRefreshEffect({
    items,
    listFocused: { current: true },
    AppState: { currentState: 'active' },
    lifecycleOf: (tournament) => getTournamentLifecycleState(tournament, clockNow),
    getRoomCredentialSchedule,
    MAX_TIMEOUT_MS,
    Platform: { OS: 'web' },
    takeTournamentStartAnnouncement,
    announcedTournamentStarts: { current: new Set() },
    Date: { now: () => fakeNow },
    setTimeout: (callback, delayMs) => {
      const timer = { callback, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => clearedTimers.push(timer),
    setClockNow: (value) => { clockNow = value; },
    setStartAnnouncement: (value) => { startAnnouncement = value; },
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
    1,
    'the upcoming match card should open the selected tournament',
  );
  assert.match(detailSource, /const id = route\?\.params\?\.id;/);
  assert.match(
    detailSource,
    /const load = useCallback\(async \(\) => \{[\s\S]*fetchTournamentDetailSnapshot\(String\(id\), api\)[\s\S]*\}, \[id\]\);/,
    'the detail reloads tournament and registration data for the ID in its own route params',
  );
  assert.match(
    appSource,
    /<Stack\.Screen name="Tabs" component=\{Tabs\}[^>]*\/>[\s\S]*<Stack\.Screen name="TDetail" component=\{TDetail\}/,
    'the pushed detail sits above the preserved Tabs/Home screen for Android Back',
  );
});

test('Home match shortcut Back flow preserves Home and loads fresh data for a second match', async () => {
  const tabRouter = TabRouter({ initialRouteName: 'Home' });
  const homeTabState = tabRouter.getInitialState({
    routeNames: ['Home', 'MyMatches', 'Tournaments', 'Wallet', 'Profile'],
    routeParamList: {},
    routeGetIdList: {},
  });
  const stackRouter = StackRouter({ initialRouteName: 'Tabs' });
  let rootState = stackRouter.getInitialState({
    routeNames: ['Tabs', 'TDetail'],
    routeParamList: {},
    routeGetIdList: {},
  });
  rootState.routes[0].state = homeTabState;

  const routerOptions = (state) => ({
    routeNames: state.routeNames,
    routeParamList: {},
    routeGetIdList: {},
    routeKeyList: state.routes.map((route) => route.key),
  });
  const rootNavigation = {
    push(name, params) {
      const nextState = stackRouter.getStateForAction(
        rootState,
        StackActions.push(name, params),
        routerOptions(rootState),
      );
      assert.ok(nextState, `the root navigator should accept a push to ${name}`);
      rootState = nextState;
    },
    canGoBack() {
      return rootState.index > 0;
    },
    goBack() {
      const nextState = stackRouter.getStateForAction(
        rootState,
        CommonActions.goBack(),
        routerOptions(rootState),
      );
      if (!nextState) return false;
      rootState = nextState;
      return true;
    },
  };
  const homeNavigation = { getParent: () => rootNavigation };
  const openTournamentDetail = evaluateTypeScriptExpression(
    findVariableInitializer(homeSourceFile, 'openTournamentDetail'),
    homeSourceFile,
    { nav: homeNavigation },
  );
  const fixtures = new Map([
    ['shortcut-match-one', { id: 'shortcut-match-one', name: 'First Home Shortcut Match' }],
    ['shortcut-match-two', { id: 'shortcut-match-two', name: 'Second Home Shortcut Match' }],
  ]);
  const detailReadIds = [];
  const api = {
    async tournament(id) {
      const requestedId = String(id);
      detailReadIds.push(requestedId);
      const fixture = fixtures.get(requestedId);
      if (!fixture) throw new Error(`Missing isolated tournament fixture: ${requestedId}`);
      return { ...fixture };
    },
    async myRegistrations() {
      return [];
    },
  };
  const routeIdExpression = findVariableInitializer(detailSourceFile, 'id');
  const loadInitializer = findVariableInitializer(detailSourceFile, 'load');
  assert.ok(ts.isCallExpression(loadInitializer), 'TDetail load should remain a useCallback call');
  const loadCallback = loadInitializer.arguments[0];
  assert.ok(ts.isArrowFunction(loadCallback), 'TDetail load should remain an async callback');
  const detailTitleExpression = findDetailTitleExpression();

  async function loadActiveDetail() {
    const activeRoute = rootState.routes[rootState.index];
    assert.equal(activeRoute.name, 'TDetail');
    const route = { params: activeRoute.params };
    const id = evaluateTypeScriptExpression(routeIdExpression, detailSourceFile, { route });
    const screenState = { tournament: null, loading: true, error: '' };
    const load = evaluateTypeScriptExpression(loadCallback, detailSourceFile, {
      id,
      api,
      detailLoadInFlight: { current: false },
      fetchTournamentDetailSnapshot,
      setT: (tournament) => { screenState.tournament = tournament; },
      setLoading: (loading) => { screenState.loading = loading; },
      setErr: (error) => { screenState.error = error; },
    });
    await load();
    return {
      id,
      title: evaluateTypeScriptExpression(
        detailTitleExpression,
        detailSourceFile,
        { t: screenState.tournament },
      ),
      ...screenState,
    };
  }

  function assertHomeIsActive() {
    const activeRoute = rootState.routes[rootState.index];
    assert.equal(activeRoute.name, 'Tabs');
    assert.equal(
      activeRoute.state.routes[activeRoute.state.index].name,
      'Home',
      'the preserved nested tab should still be Home',
    );
  }

  function triggerAndroidBack() {
    if (!rootNavigation.canGoBack()) return false;
    return rootNavigation.goBack();
  }

  openTournamentDetail('shortcut-match-one');
  assert.deepEqual(
    rootState.routes.map((route) => route.name),
    ['Tabs', 'TDetail'],
    'the first Home shortcut should push detail above the preserved tabs',
  );
  assert.equal(rootState.routes[rootState.index].params.id, 'shortcut-match-one');
  const firstDetail = await loadActiveDetail();
  assert.equal(firstDetail.id, 'shortcut-match-one');
  assert.equal(firstDetail.title, 'First Home Shortcut Match');
  assert.equal(firstDetail.loading, false);
  assert.equal(firstDetail.error, '');
  assert.deepEqual(detailReadIds, ['shortcut-match-one']);

  assert.equal(triggerAndroidBack(), true, 'Android Back should pop the first detail');
  assert.deepEqual(rootState.routes.map((route) => route.name), ['Tabs']);
  assertHomeIsActive();

  openTournamentDetail('shortcut-match-two');
  assert.deepEqual(
    rootState.routes.map((route) => route.name),
    ['Tabs', 'TDetail'],
    'the second Home shortcut should push a new detail above Home',
  );
  assert.equal(rootState.routes[rootState.index].params.id, 'shortcut-match-two');
  const secondDetail = await loadActiveDetail();
  assert.equal(secondDetail.id, 'shortcut-match-two');
  assert.equal(secondDetail.title, 'Second Home Shortcut Match');
  assert.notEqual(secondDetail.title, firstDetail.title);
  assert.equal(secondDetail.loading, false);
  assert.equal(secondDetail.error, '');
  assert.deepEqual(detailReadIds, ['shortcut-match-one', 'shortcut-match-two']);

  assert.equal(triggerAndroidBack(), true, 'Android Back should pop the second detail');
  assert.deepEqual(rootState.routes.map((route) => route.name), ['Tabs']);
  assertHomeIsActive();
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

test('empty format-filtered lifecycle tabs announce the selected mode and team size without leaking other tournaments', () => {
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
    /const emptyMessage = tournamentListEmptyMessage\(false,\s*tabLabel\[tab\],\s*heading,\s*teamType\)/,
  );
  assert.match(
    tournamentsSource,
    /ListEmptyComponent=\{error \? null : \(\s*<Empty text=\{emptyMessage\} accessibilityLabel=\{emptyMessage\} \/>\s*\)\}/,
    'the one visible no-results message should also be its explicit screen-reader label',
  );
  assert.match(
    uiSource,
    /accessible=\{accessibilityLabel \? true : undefined\}\s+accessibilityRole=\{accessibilityLabel \? 'text' : undefined\}\s+accessibilityLabel=\{accessibilityLabel\}/,
    'an explicitly labeled empty-state caption should be a single accessible text item',
  );
  assert.equal(
    tournamentListEmptyMessage(true, 'Completed', 'CLASH SQUAD', 'duo'),
    'Tournament data is unavailable right now. Pull to refresh and try again.',
  );
  assert.match(
    tournamentsSource,
    /testID=\{hasLoadedList\.current \? 'player-tournament-refresh-error' : 'player-tournament-load-error'\}/,
    'a list error should remain represented by the distinct load or refresh error message',
  );
});