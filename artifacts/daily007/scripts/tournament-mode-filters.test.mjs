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
import { createFocusedRefreshCoalescer } from '../src/lib/focusedLatestRequest.ts';
import {
  createNetworkEventRevision,
  isUsableNetworkState,
} from '../src/lib/focusedRetry.ts';
import {
  getNextRoomCredentialRefreshAtMs,
  getRoomCredentialSchedule,
  hasServerAuthorizedRoomCredentials,
  ROOM_CREDENTIAL_PENDING_REFRESH_INTERVAL_MS,
} from '../src/lib/roomCredentialTiming.ts';
import { fetchTournamentDetailSnapshot } from '../src/lib/tournament-detail-refresh.ts';
import {
  createTournamentRefreshSingleFlight,
  getTournamentLifecycleState,
  MAX_COMPLETED_TOURNAMENTS,
  MAX_TIMEOUT_MS,
  mostRecentCompletedTournaments,
  startTournamentListRefreshPolling,
  TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
} from '../src/lib/tournamentLifecycle.ts';
import { takeTournamentStartAnnouncement } from '../src/lib/tournamentStartAnnouncement.ts';

const homeSource = await readFile(
  new URL('../src/screens/Home.tsx', import.meta.url),
  'utf8',
);
const typographySource = await readFile(
  new URL('../src/components/typography.tsx', import.meta.url),
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
const roomCredentialsPanelSource = await readFile(
  new URL('../src/components/RoomCredentialsPanel.tsx', import.meta.url),
  'utf8',
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

function loadTournamentFocusEffect(scope) {
  let effectCallback;

  function visit(node) {
    if (
      ts.isCallExpression(node)
      && node.expression.getText(tournamentsSourceFile) === 'useFocusEffect'
      && ts.isCallExpression(node.arguments[0])
      && node.arguments[0].expression.getText(tournamentsSourceFile) === 'useCallback'
      && ts.isArrowFunction(node.arguments[0].arguments[0])
    ) {
      effectCallback = node.arguments[0].arguments[0];
    }
    ts.forEachChild(node, visit);
  }

  visit(tournamentsSourceFile);
  assert.ok(effectCallback, 'the Tournaments focus effect should be present');
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

function createTournamentLoadHarness(api, now = () => Date.now()) {
  const state = {
    items: [],
    error: '',
    registrationError: '',
    loading: true,
    clockNow: 0,
    playerLoadAnnouncement: '',
    playerRefreshAnnouncementVersion: 0,
  };
  const screen = { selectedTab: 'upcoming' };
  const refs = {
    loadRequests: { current: createLatestRequestGuard() },
    hasLoadedList: { current: false },
    initialLoadFailed: { current: false },
    latestLoadFailed: { current: false },
    refreshingRequest: { current: false },
    failedManualRefresh: { current: false },
    activeLoad: { current: null },
  };
  const loadScope = {
    useCallback: (callback) => callback,
    api,
    apiError: (error) => error instanceof Error ? error.message : String(error),
    loadRequests: refs.loadRequests,
    hasLoadedList: refs.hasLoadedList,
    initialLoadFailed: refs.initialLoadFailed,
    latestLoadFailed: refs.latestLoadFailed,
    refreshingRequest: refs.refreshingRequest,
    failedManualRefresh: refs.failedManualRefresh,
    activeLoad: refs.activeLoad,
    setItems: (nextItems) => {
      state.items = typeof nextItems === 'function' ? nextItems(state.items) : nextItems;
    },
    setError: (error) => { state.error = error; },
    setRegistrationError: (error) => { state.registrationError = error; },
    setLoading: (loading) => { state.loading = loading; },
    setClockNow: (clockNow) => { state.clockNow = clockNow; },
    setPlayerLoadAnnouncement: (announcement) => { state.playerLoadAnnouncement = announcement; },
    setPlayerRefreshAnnouncementVersion: (update) => {
      state.playerRefreshAnnouncementVersion = typeof update === 'function'
        ? update(state.playerRefreshAnnouncementVersion)
        : update;
    },
    setTab: (selectedTab) => { screen.selectedTab = selectedTab; },
    Date: { now },
  };
  const loadLatest = evaluateTypeScriptExpression(
    findVariableInitializer(tournamentsSourceFile, 'loadLatest'),
    tournamentsSourceFile,
    loadScope,
  );
  const load = evaluateTypeScriptExpression(
    findVariableInitializer(tournamentsSourceFile, 'load'),
    tournamentsSourceFile,
    { ...loadScope, loadLatest },
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

test('format cards stack their details and remain scrollable at 1.5x Android text', () => {
  const formatSection = modeSubmodesSource.slice(
    modeSubmodesSource.indexOf('<View style={styles.formats}>'),
    modeSubmodesSource.indexOf('<Text style={styles.note}'),
  );
  const formatCardStyle = /formatCard:\s*\{([^}]*)\}/.exec(modeSubmodesSource)?.[1] ?? '';

  assert.match(modeSubmodesSource, /const largeText = fontScale >= 1\.5/);
  assert.match(modeSubmodesSource, /<ScrollView style=\{styles\.root\} contentContainerStyle=\{styles\.content\}>/);
  assert.match(formatSection, /style=\{\[styles\.formatCard,\s*largeText && styles\.formatCardLarge\]\}/);
  assert.match(formatSection, /formatContent,\s*largeText && styles\.formatContentLarge/);
  assert.match(formatSection, /formatTopRow,\s*largeText && styles\.formatTopRowLarge/);
  assert.match(formatSection, /formatInfo,\s*largeText && styles\.formatInfoLarge/);
  assert.match(modeSubmodesSource, /formatContentLarge:\s*\{\s*flexDirection:\s*'column'/);
  assert.match(modeSubmodesSource, /formatTopRowLarge:\s*\{\s*width:\s*'100%'/);
  assert.match(modeSubmodesSource, /formatInfoLarge:\s*\{\s*flex:\s*0,\s*width:\s*'100%'/);
  assert.doesNotMatch(formatCardStyle, /(?:^|,)\s*height\s*:/);
  assert.doesNotMatch(formatSection, /numberOfLines=|ellipsizeMode=/);

  for (const [type, title] of [['solo', 'SOLO'], ['duo', 'DUO'], ['squad', 'SQUAD']]) {
    assert.match(modeSubmodesSource, new RegExp(`\\{ type: '${type}', title: '${title}'`));
  }
  assert.match(formatSection, /testID=\{`format-\$\{gameMode\}-\$\{format\.type\}`\}/);
  assert.match(formatSection, /accessibilityLabel=\{`\$\{mode\.title\}, \$\{format\.title\}, \$\{capacity\.label\}`\}/);
  assert.match(formatSection, /onPress=\{\(\) => navigation\.navigate\([\s\S]*?submodeRouteParams\(gameMode,\s*format\.type,\s*mode\.title\)/);
  assert.match(formatSection, /style=\{styles\.formatName\}>\{format\.title\}<\/Text>/);
  assert.match(formatSection, /per team<\/Text>/);
  assert.match(formatSection, />\{capacity\.label\}<\/Text>/);
});

test('Home mode cards keep every lifecycle tab mode-scoped and the format picker format-scoped', () => {
  const lifecycleTabs = ['upcoming', 'ongoing', 'completed'];
  const formats = ['Solo', 'Duo', 'Squad'];
  const tournaments = HOME_GAME_MODE_CARDS.flatMap(({ gameMode }) =>
    formats.flatMap((teamType) =>
      lifecycleTabs.map((lifecycle) => ({
        id: `${gameMode}-${teamType.toLowerCase()}-${lifecycle}`,
        gameMode,
        teamType,
        lifecycle,
      })),
    ),
  );
  const lifecycleOf = (tournament) => tournament.lifecycle;

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
      lifecycleOf,
    );
    for (const lifecycle of lifecycleTabs) {
      assert.deepEqual(
        directTabs[lifecycle].map((tournament) => tournament.id),
        formats.map((teamType) =>
          `${card.gameMode}-${teamType.toLowerCase()}-${lifecycle}`
        ),
        `${card.mode} ${lifecycle} should include every format in that mode only`,
      );
    }

    for (const teamType of formats) {
      const pickerParams = submodeRouteParams(card.gameMode, teamType.toLowerCase(), card.mode);
      assert.deepEqual(pickerParams, {
        gameMode: card.gameMode,
        teamType: teamType.toLowerCase(),
        gameModeLabel: card.mode,
      });
      const pickerTabs = tournamentTabsForRoute(
        tournaments,
        pickerParams,
        lifecycleOf,
      );
      for (const lifecycle of lifecycleTabs) {
        assert.deepEqual(
          pickerTabs[lifecycle].map((tournament) => tournament.id),
          [`${card.gameMode}-${teamType.toLowerCase()}-${lifecycle}`],
          `${card.mode} ${teamType} ${lifecycle} should remain format-scoped`,
        );
      }
    }
  }
});

test('Home mode cards reflow and stay tappable with Android text scaled to 1.5x', () => {
  const gameModeSection = homeSource.slice(
    homeSource.indexOf('{/* ===== GAME MODES ===== */}'),
    homeSource.indexOf('<HomeLeaderboards'),
  );
  const baseModeCardStyle = /modeCard:\s*\{([^}]*)\}/.exec(homeSource)?.[1] ?? '';

  assert.match(homeSource, /const largeModeCard = fontScale >= 1\.5/);
  assert.match(gameModeSection, /style=\{\[s\.modeCard,\s*largeModeCard && s\.modeCardLarge/);
  assert.match(gameModeSection, /modeArtWrap,\s*largeModeCard && s\.modeArtWrapLarge/);
  assert.match(gameModeSection, /modeBody,\s*largeModeCard && s\.modeBodyLarge/);
  assert.match(gameModeSection, /modeBtn,\s*largeModeCard && s\.modeBtnLarge/);
  assert.match(homeSource, /modeCardLarge:\s*\{\s*flexDirection:\s*'column'/);
  assert.match(homeSource, /modeArtWrapLarge:\s*\{\s*width:\s*'100%'/);
  assert.match(homeSource, /modeBodyLarge:\s*\{\s*flex:\s*0/);
  assert.match(homeSource, /modeBtnLarge:\s*\{\s*marginTop:\s*12,\s*minHeight:\s*52/);
  assert.match(homeSource, /modeBtnTLarge:\s*\{\s*fontSize:\s*12/);
  assert.doesNotMatch(baseModeCardStyle, /(?:^|,)\s*height\s*:/);
  assert.doesNotMatch(gameModeSection, /numberOfLines=|ellipsizeMode=/);

  assert.match(homeSource, /<ScrollView style=\{\{\s*flex:\s*1,/);
  assert.match(gameModeSection, /onPress=\{\(\) => nav\.navigate\('Tournaments', homeModeRouteParams\(m\)\)\}/);
  assert.match(gameModeSection, /accessibilityLabel=\{`Open \$\{m\.mode\} tournaments\./);
  assert.match(gameModeSection, /testID=\{`home-mode-\$\{m\.mode/);
  assert.match(gameModeSection, />BROWSE TOURNAMENTS<\/Text>/);

  assert.match(typographySource, /<NativeText\s+\{\.\.\.props\}/);
  assert.doesNotMatch(typographySource, /allowFontScaling\s*=\s*\{false\}/);
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
  const loadStart = tournamentsSource.indexOf('const loadLatest = useCallback(async () => {');
  const loadEnd = tournamentsSource.indexOf('}, []);', loadStart);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'the tournament loader should be present');
  assert.doesNotMatch(
    tournamentsSource.slice(loadStart, loadEnd),
    /setTab\s*\(/,
    'refreshing data should not reset the selected lifecycle tab',
  );
  assert.match(
    tournamentsSource,
    /useFocusEffect\(useCallback\(\(\) => \{\s*listFocused\.current = true;\s*connectivityRefreshes\.setFocused\(true\);[\s\S]*?const stopCompletionPolling = startTournamentListRefreshPolling\([\s\S]*?listFocused\.current && AppState\.currentState === 'active'[\s\S]*?TOURNAMENT_LIST_REFRESH_INTERVAL_MS[\s\S]*?\);[\s\S]*?if \(AppState\.currentState === 'active'\) void load\('focus'\);\s*return \(\) => \{\s*active = false;\s*listFocused\.current = false;\s*connectivityRefreshes\.setFocused\(false\);[\s\S]*?stopCompletionPolling\(\);\s*networkSubscription\.remove\(\);\s*\};\s*\}, \[completionRefresh, connectivityRefreshes, load\]\)\)/,
  );
  assert.match(tournamentsSource, /Network\.addNetworkStateListener/);
  assert.match(tournamentsSource, /Network\.getNetworkStateAsync\(\)/);
  assert.match(tournamentsSource, /connectivityRefreshes\.request\(\(\) => \{/);
  assert.match(tournamentsSource, /const latestLoadFailed = useRef\(false\)/);
  assert.match(tournamentsSource, /latestLoadFailed\.current = !registrationStatusKnown/);
  assert.match(tournamentsSource, /latestLoadFailed\.current = true/);
  assert.match(
    tournamentsSource,
    /const returnedToApp = appState\.current !== 'active' && nextState === 'active';\s*appState\.current = nextState;\s*if \(returnedToApp && listFocused\.current\) \{\s*setClockNow\(Date\.now\(\)\);\s*void load\('resume'\);\s*\}/,
  );
  assert.match(
    tournamentsSource,
    /if \(nextTransition <= now && listFocused\.current && AppState\.currentState === 'active'\) \{[\s\S]*?setClockNow\(now\);\s*void load\('scheduled'\);\s*\}/,
  );
  assert.match(
    tournamentsSource,
    /const onRefresh = async \(\) => \{\s*if \(refreshingRequest\.current\) return;\s*refreshingRequest\.current = true;\s*setRefreshing\(true\);\s*try \{\s*await load\('manual'\);\s*\} finally \{\s*refreshingRequest\.current = false;\s*setRefreshing\(false\);\s*\}\s*\};/,
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
    /ListEmptyComponent=\{error \? null : \(\s*<View style=\{s\.emptyState\}>\s*<Text[\s\S]*?accessibilityLabel=\{emptyMessage\.replace\('\\n', ' '\)\}[\s\S]*?style=\{s\.emptyMessage\}[\s\S]*?\{emptyMessage\}[\s\S]*?<\/Text>\s*<\/View>\s*\)\}/,
  );
});

test('a failed T-5 registration refresh is retried after connectivity returns and reveals only approved room details', async () => {
  const startAtMs = Date.parse('2026-10-08T14:00:00.000Z');
  const schedule = getRoomCredentialSchedule(new Date(startAtMs).toISOString());
  assert.ok(schedule);
  let fakeNow = schedule.releaseAtMs - 1_000;
  const matches = [
    {
      id: 'approved-room',
      status: 'upcoming',
      startsAt: new Date(startAtMs).toISOString(),
    },
    {
      id: 'pending-room',
      status: 'upcoming',
      startsAt: new Date(startAtMs + 10 * 60_000).toISOString(),
    },
  ];
  let registrationCalls = 0;
  let resolveReconnectRequest;
  const reconnectRequest = new Promise((resolve) => { resolveReconnectRequest = resolve; });
  const api = {
    tournaments: async () => matches,
    myRegistrations: async () => {
      registrationCalls += 1;
      if (registrationCalls === 2) throw new Error('Temporary connectivity failure');
      if (registrationCalls === 3) resolveReconnectRequest();
      const approved = {
        tournamentId: 'approved-room',
        status: 'approved',
        roomPublished: true,
        roomId: fakeNow >= schedule.releaseAtMs ? 'ROOM-APPROVED-RECOVERED' : null,
        roomPassword: fakeNow >= schedule.releaseAtMs ? 'PASS-APPROVED-RECOVERED' : null,
      };
      return [
        approved,
        {
          tournamentId: 'pending-room',
          status: 'pending',
          roomPublished: true,
          roomId: null,
          roomPassword: null,
        },
      ];
    },
  };
  const harness = createTournamentLoadHarness(api, () => fakeNow);
  const timers = [];
  const canceledTimers = new Set();
  const connectivityRefreshes = createFocusedRefreshCoalescer({
    setTimeout: (callback, delayMs) => {
      const timer = { callback, delayMs };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => canceledTimers.add(timer),
  });
  let networkListener;
  const focusEffect = loadTournamentFocusEffect({
    AppState: { currentState: 'active' },
    Network: {
      addNetworkStateListener: (listener) => {
        networkListener = listener;
        return { remove() {} };
      },
      getNetworkStateAsync: async () => ({
        isConnected: false,
        isInternetReachable: false,
      }),
    },
    connectivityRefreshes,
    createNetworkEventRevision,
    isUsableNetworkState,
    listFocused: { current: false },
    load: harness.load,
    Date: { now: () => fakeNow },
    setClockNow: (value) => { harness.state.clockNow = value; },
    startTournamentListRefreshPolling: () => () => {},
    TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
  });
  const cleanupFocus = focusEffect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(registrationCalls, 1, 'focus should load the pre-release status once');
  assert.ok(networkListener, 'the focused screen should listen for network changes');

  const lifecycleTimers = [];
  let scheduledRefresh = Promise.resolve();
  const lifecycleEffect = loadLifecycleRefreshEffect({
    items: harness.state.items,
    listFocused: { current: true },
    AppState: { currentState: 'active' },
    lifecycleOf: (tournament) => getTournamentLifecycleState(tournament, harness.state.clockNow),
    getRoomCredentialSchedule,
    getNextRoomCredentialRefreshAtMs,
    MAX_TIMEOUT_MS,
    Platform: { OS: 'web' },
    takeTournamentStartAnnouncement,
    announcedTournamentStarts: { current: new Set() },
    Date: { now: () => fakeNow },
    setTimeout: (callback, delayMs) => {
      const timer = { callback, delayMs };
      lifecycleTimers.push(timer);
      return timer;
    },
    clearTimeout() {},
    setClockNow: (value) => { harness.state.clockNow = value; },
    setStartAnnouncement() {},
    load: (trigger) => {
      scheduledRefresh = harness.load(trigger);
      return scheduledRefresh;
    },
  });
  const cleanupLifecycle = lifecycleEffect();
  assert.equal(lifecycleTimers.length, 1);
  assert.equal(lifecycleTimers[0].delayMs, 1_020);
  fakeNow = schedule.releaseAtMs + 20;
  lifecycleTimers[0].callback();
  await scheduledRefresh;

  assert.equal(registrationCalls, 2, 'the T-5 load should fail once while the network is unavailable');
  assert.equal(harness.refs.latestLoadFailed.current, true);
  assert.equal(
    hasServerAuthorizedRoomCredentials(
      harness.state.items[0].myRegistration.roomId,
      harness.state.items[0].myRegistration.roomPassword,
    ),
    false,
    'a failed T-5 read must not invent or expose credentials',
  );

  networkListener({ isConnected: false, isInternetReachable: false });
  networkListener({ isConnected: true, isInternetReachable: true });
  networkListener({ isConnected: true, isInternetReachable: true });
  assert.equal(
    timers.filter((timer) => !canceledTimers.has(timer)).length,
    1,
    'a burst of restored-connectivity events should queue only one refresh',
  );
  const reconnectTimer = timers.find((timer) => !canceledTimers.has(timer));
  assert.equal(reconnectTimer.delayMs, 250, 'the reconnect refresh should use the coalescing delay');
  reconnectTimer.callback();
  await reconnectRequest;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(registrationCalls, 3, 'connectivity restoration should issue one retry without manual refresh');
  const approved = harness.state.items.find((item) => item.id === 'approved-room').myRegistration;
  assert.deepEqual(
    { roomId: approved.roomId, roomPassword: approved.roomPassword },
    {
      roomId: 'ROOM-APPROVED-RECOVERED',
      roomPassword: 'PASS-APPROVED-RECOVERED',
    },
  );
  const pending = harness.state.items.find((item) => item.id === 'pending-room').myRegistration;
  assert.equal(pending.status, 'pending');
  assert.equal(
    hasServerAuthorizedRoomCredentials(pending.roomId, pending.roomPassword),
    false,
    'pending registrations must remain without room credentials',
  );
  assert.equal(harness.refs.latestLoadFailed.current, false);

  cleanupLifecycle();
  cleanupFocus();
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
  assert.equal(harness.state.error, '');
  assert.equal(harness.state.registrationError, 'Registration service unavailable');
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

test('first-load registration failure keeps tournament counts and marks entry status unknown until retry', async () => {
  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const pastStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const initialTournaments = [
    { id: 'initial-upcoming', status: 'upcoming', startsAt: futureStart },
    { id: 'initial-ongoing', status: 'ongoing', startsAt: pastStart },
    { id: 'initial-completed', status: 'completed', startsAt: pastStart },
  ];
  let registrationsFail = true;
  const api = {
    tournaments: async () => initialTournaments,
    myRegistrations: async () => {
      if (registrationsFail) throw new Error('Temporary registration lookup failure');
      return [{ tournamentId: 'initial-upcoming', status: 'approved' }];
    },
  };
  const harness = createTournamentLoadHarness(api);
  const getTabCounts = () => Object.fromEntries(
    Object.entries(tournamentTabsForRoute(
      harness.state.items,
      {},
      (tournament) => getTournamentLifecycleState(tournament, harness.state.clockNow),
    )).map(([name, tournaments]) => [name, tournaments.length]),
  );

  await harness.load();

  assert.equal(harness.state.loading, false, 'successful tournament rows should render despite the registration failure');
  assert.deepEqual(harness.state.items.map((tournament) => tournament.id), [
    'initial-upcoming',
    'initial-ongoing',
    'initial-completed',
  ]);
  assert.deepEqual(getTabCounts(), { upcoming: 1, ongoing: 1, completed: 1 });
  for (const tournament of harness.state.items) {
    assert.equal(tournament.joined, undefined);
    assert.equal(tournament.joinedStatusUnknown, true);
  }
  assert.equal(harness.state.error, '', 'a failed registration lookup should not replace the successful tournament list with a list error');
  assert.equal(harness.state.registrationError, 'Temporary registration lookup failure');
  assert.equal(
    harness.state.items.find((tournament) => tournament.id === 'initial-upcoming').myRegistration,
    undefined,
  );
  assert.match(
    tournamentsSource,
    /text=\{`Could not confirm which tournaments you have joined: \$\{registrationError\}\. \$\{hasLoadedList\.current \? 'Showing your last confirmed status; refresh to try again\.' : 'Entry status is unknown; refresh before joining\.'\}`\}/,
  );
  assert.match(uiSource, /const statusUnknown = t\?\.joinedStatusUnknown === true;/);
  assert.match(uiSource, /statusUnknown\s*\?\s*'ENTRY STATUS UNKNOWN · TAP TO CHECK →'/);

  registrationsFail = false;
  await harness.load();

  assert.deepEqual(getTabCounts(), { upcoming: 1, ongoing: 1, completed: 1 });
  const recoveredUpcoming = harness.state.items.find((tournament) => tournament.id === 'initial-upcoming');
  assert.equal(recoveredUpcoming.joinedStatusUnknown, false);
  assert.equal(recoveredUpcoming.joined, true);
  assert.equal(recoveredUpcoming.myRegistration.status, 'approved');
  assert.equal(harness.state.registrationError, '', 'a valid retry should clear the registration warning');
  assert.equal(harness.state.error, '');
});

test('malformed registration refresh preserves confirmed JOINED cards until valid data arrives', async () => {
  const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let tournaments = [
    { id: 'joined-match', status: 'upcoming', startsAt: futureStart, title: 'Confirmed match' },
  ];
  let registrations = [{ tournamentId: 'joined-match', status: 'approved' }];
  const api = {
    tournaments: async () => tournaments,
    myRegistrations: async () => registrations,
  };
  const harness = createTournamentLoadHarness(api);

  await harness.load();
  const confirmedItems = harness.state.items;
  assert.equal(confirmedItems[0].joined, true);
  assert.equal(confirmedItems[0].joinedStatusUnknown, false);

  tournaments = [
    { id: 'joined-match', status: 'upcoming', startsAt: futureStart, title: 'Updated match' },
    { id: 'new-match', status: 'upcoming', startsAt: futureStart, title: 'New match' },
  ];
  registrations = { invalid: true };
  await harness.load();

  assert.strictEqual(harness.state.items, confirmedItems, 'malformed registration data must not replace the confirmed snapshot');
  assert.equal(harness.state.items[0].joined, true, 'the last confirmed JOINED state must remain visible');
  assert.equal(harness.state.registrationError, 'Invalid registrations response.');
  assert.equal(harness.state.error, '', 'the registration issue must not hide tournament cards behind a list error');

  registrations = [];
  await harness.load();

  assert.notStrictEqual(harness.state.items, confirmedItems);
  assert.deepEqual(harness.state.items.map((tournament) => tournament.id), ['joined-match', 'new-match']);
  assert.equal(harness.state.items[0].joined, false, 'a later valid response should update status normally');
  assert.equal(harness.state.items[0].title, 'Updated match');
  assert.equal(harness.state.registrationError, '');
  assert.equal(harness.state.error, '');
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
  const loadStart = tournamentsSource.indexOf('const loadLatest = useCallback(async () => {');
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
    getNextRoomCredentialRefreshAtMs,
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

test('focused tournament polling moves server-completed matches and their tab counts', async () => {
  assert.equal(TOURNAMENT_LIST_REFRESH_INTERVAL_MS, 30_000);
  let serverStatus = 'ongoing';
  let failNextTournamentRequest = false;
  let tournamentRequests = 0;
  const startsAt = '2026-10-08T12:00:00.000Z';
  const completedAt = '2026-10-08T12:12:00.000Z';
  const api = {
    tournaments: async () => {
      tournamentRequests += 1;
      if (failNextTournamentRequest) {
        failNextTournamentRequest = false;
        throw new Error('Temporary tournament service error');
      }
      return [
        {
          id: 'server-completes',
          gameMode: 'clash_squad',
          teamType: 'Duo',
          status: serverStatus,
          startsAt,
          completedAt: serverStatus === 'completed' ? completedAt : null,
        },
        {
          id: 'still-ongoing',
          gameMode: 'clash_squad',
          teamType: 'Duo',
          status: 'ongoing',
          startsAt,
        },
      ];
    },
    myRegistrations: async () => [],
  };
  const harness = createTournamentLoadHarness(api, () => Date.parse('2026-10-08T12:20:00.000Z'));
  await harness.load();
  const lastCompleteItems = harness.state.items;
  const getCounts = () => Object.fromEntries(
    Object.entries(tournamentTabsForRoute(
      harness.state.items,
      { gameMode: 'clash_squad' },
      (tournament) => getTournamentLifecycleState(tournament, harness.state.clockNow),
    )).map(([name, tournaments]) => [name, tournaments.length]),
  );
  assert.deepEqual(getCounts(), { upcoming: 0, ongoing: 2, completed: 0 });

  let focused = true;
  let appState = 'active';
  let intervalCallback;
  let intervalDelay;
  const clearedIntervals = [];
  let refreshCalls = 0;
  let scheduledRefresh = Promise.resolve();
  const stopPolling = startTournamentListRefreshPolling(
    () => {
      refreshCalls += 1;
      scheduledRefresh = (async () => {
        harness.state.clockNow = Date.parse('2026-10-08T12:20:00.000Z');
        await harness.load();
      })();
    },
    () => focused && appState === 'active',
    TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
    {
      setInterval: (callback, delayMs) => {
        intervalCallback = callback;
        intervalDelay = delayMs;
        return 'completion-poll';
      },
      clearInterval: (interval) => clearedIntervals.push(interval),
    },
  );

  assert.equal(intervalDelay, TOURNAMENT_LIST_REFRESH_INTERVAL_MS);
  assert.equal(refreshCalls, 0);
  serverStatus = 'completed';
  failNextTournamentRequest = true;
  intervalCallback();
  await scheduledRefresh;

  assert.equal(refreshCalls, 1);
  assert.equal(tournamentRequests, 2);
  assert.strictEqual(
    harness.state.items,
    lastCompleteItems,
    'a failed completion poll must preserve the last complete tournament snapshot',
  );
  assert.deepEqual(
    getCounts(),
    { upcoming: 0, ongoing: 2, completed: 0 },
    'tab counts must remain based on the last complete snapshot after a failed poll',
  );
  assert.equal(harness.state.error, 'Temporary tournament service error');

  focused = false;
  intervalCallback();
  focused = true;
  appState = 'background';
  intervalCallback();
  assert.equal(refreshCalls, 1, 'a failed poll must not retry while blurred or backgrounded');
  assert.equal(tournamentRequests, 2);

  appState = 'active';
  intervalCallback();
  await scheduledRefresh;

  assert.equal(refreshCalls, 2);
  assert.equal(tournamentRequests, 3);
  assert.deepEqual(getCounts(), { upcoming: 0, ongoing: 1, completed: 1 });
  assert.equal(
    harness.state.items.find((tournament) => tournament.id === 'server-completes').status,
    'completed',
    'completion must come from the refreshed server snapshot, not an estimated match duration',
  );
  assert.equal(
    harness.state.items.find((tournament) => tournament.id === 'server-completes').startsAt,
    startsAt,
    'the start instant stays unchanged when server completion arrives',
  );
  focused = false;
  intervalCallback();
  focused = true;
  appState = 'background';
  intervalCallback();
  assert.equal(refreshCalls, 2, 'blurred or backgrounded lists must not request another server snapshot');

  stopPolling();
  assert.deepEqual(clearedIntervals, ['completion-poll']);
});

test('a slow tournament poll stays single-flight while manual refresh supersedes its response', async () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
    return { promise, resolve };
  };
  const requests = [];
  const api = {
    tournaments: () => {
      const request = deferred();
      requests.push({ tournaments: request });
      return request.promise;
    },
    myRegistrations: () => {
      const request = deferred();
      requests.at(-1).registrations = request;
      return request.promise;
    },
  };
  const harness = createTournamentLoadHarness(api);
  let intervalCallback;
  let pendingPoll;
  const completionRefresh = createTournamentRefreshSingleFlight();
  const stopPolling = startTournamentListRefreshPolling(
    () => {
      pendingPoll = completionRefresh.run(() => harness.load('scheduled'));
      return pendingPoll;
    },
    () => true,
    TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
    {
      setInterval: (callback) => {
        intervalCallback = callback;
        return 'slow-completion-poll';
      },
      clearInterval: () => {},
    },
  );

  intervalCallback();
  await Promise.resolve();
  assert.equal(requests.length, 1, 'the first poll should start one paired data request');

  intervalCallback();
  await Promise.resolve();
  assert.equal(requests.length, 1, 'an elapsed poll interval must not duplicate a pending poll');

  const manualRefresh = harness.load('manual');
  await Promise.resolve();
  assert.equal(requests.length, 2, 'pull-to-refresh should start a fresh request while the poll is pending');
  requests[1].tournaments.resolve([{ id: 'newer-result', status: 'ongoing' }]);
  requests[1].registrations.resolve([]);
  await manualRefresh;
  assert.deepEqual(harness.state.items.map(({ id }) => id), ['newer-result']);

  intervalCallback();
  await Promise.resolve();
  assert.equal(
    requests.length,
    2,
    'the periodic lock must remain held while the original poll is pending, even after manual refresh finishes',
  );

  stopPolling();
  let restartedIntervalCallback;
  const stopRestartedPolling = startTournamentListRefreshPolling(
    () => {
      pendingPoll = completionRefresh.run(() => harness.load('scheduled'));
      return pendingPoll;
    },
    () => true,
    TOURNAMENT_LIST_REFRESH_INTERVAL_MS,
    {
      setInterval: (callback) => {
        restartedIntervalCallback = callback;
        return 'restarted-completion-poll';
      },
      clearInterval: () => {},
    },
  );
  restartedIntervalCallback();
  await Promise.resolve();
  assert.equal(
    requests.length,
    2,
    'recreating the poll timer must not release the screen-wide lock for an unfinished poll',
  );

  requests[0].tournaments.resolve([{ id: 'older-result', status: 'ongoing' }]);
  requests[0].registrations.resolve([]);
  await pendingPoll;
  assert.deepEqual(
    harness.state.items.map(({ id }) => id),
    ['newer-result'],
    'the superseded poll response must not replace rows returned by the manual refresh',
  );

  restartedIntervalCallback();
  await Promise.resolve();
  assert.equal(requests.length, 3, 'a later poll can start after the previous periodic request settles');
  requests[2].tournaments.resolve([{ id: 'latest-result', status: 'ongoing' }]);
  requests[2].registrations.resolve([]);
  await pendingPoll;

  stopRestartedPolling();
});

test('scheduled lifecycle boundaries do not refresh the list while blurred or backgrounded', () => {
  const startAtMs = Date.parse('2026-10-08T14:00:00.000Z');
  for (const scenario of [
    { focused: false, appState: 'active' },
    { focused: true, appState: 'background' },
  ]) {
    let fakeNow = startAtMs - 1_000;
    let clockNow = fakeNow;
    let loadCalls = 0;
    const timers = [];
    const clearedTimers = [];
    const lifecycleEffect = loadLifecycleRefreshEffect({
      items: [{
        id: 'boundary-match',
        startsAt: new Date(startAtMs).toISOString(),
      }],
      listFocused: { current: scenario.focused },
      AppState: { currentState: scenario.appState },
      lifecycleOf: (tournament) => getTournamentLifecycleState(tournament, clockNow),
      getRoomCredentialSchedule,
      getNextRoomCredentialRefreshAtMs,
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
      setStartAnnouncement() {},
      load: () => { loadCalls += 1; },
    });

    const cleanup = lifecycleEffect();
    assert.equal(timers[0].delayMs, 1_020);
    fakeNow = startAtMs + 20;
    timers[0].callback();

    assert.equal(loadCalls, 0);
    assert.equal(clockNow, startAtMs - 1_000, 'inactive screens do not advance from a background timer');
    cleanup();
    assert.deepEqual(clearedTimers, [timers[0]]);
  }
});

test('an approved room refresh reveals credentials at T-5 without changing the selected game mode', async () => {
  const startAtMs = Date.parse('2026-10-08T14:00:00.000Z');
  const approvedSchedule = getRoomCredentialSchedule(new Date(startAtMs).toISOString());
  assert.ok(approvedSchedule);
  const releaseAtMs = approvedSchedule.releaseAtMs;
  const selectedMode = 'clash_squad';
  let fakeNow = releaseAtMs - 1_000;
  const matches = [
    {
      id: 'approved-room',
      gameMode: selectedMode,
      teamType: 'Duo',
      status: 'upcoming',
      startsAt: new Date(startAtMs).toISOString(),
    },
    {
      id: 'pending-room',
      gameMode: selectedMode,
      teamType: 'Duo',
      status: 'upcoming',
      startsAt: new Date(startAtMs + 10 * 60_000).toISOString(),
    },
    {
      id: 'other-mode-room',
      gameMode: 'battle_royale',
      teamType: 'Solo',
      status: 'upcoming',
      startsAt: new Date(startAtMs + 20 * 60_000).toISOString(),
    },
  ];
  const api = {
    tournaments: async () => matches,
    myRegistrations: async () => [
      {
        tournamentId: 'approved-room',
        status: 'approved',
        roomPublished: true,
        roomId: fakeNow >= releaseAtMs ? 'ROOM-APPROVED-101' : null,
        roomPassword: fakeNow >= releaseAtMs ? 'PASS-APPROVED-101' : null,
      },
      {
        tournamentId: 'pending-room',
        status: 'pending',
        roomPublished: true,
        roomId: null,
        roomPassword: null,
      },
      {
        tournamentId: 'other-mode-room',
        status: 'approved',
        roomPublished: true,
        roomId: null,
        roomPassword: null,
      },
    ],
  };
  const harness = createTournamentLoadHarness(api, () => fakeNow);
  await harness.load();

  const approvedBefore = harness.state.items.find((tournament) => tournament.id === 'approved-room');
  assert.equal(harness.state.clockNow, fakeNow);
  assert.equal(
    hasServerAuthorizedRoomCredentials(
      approvedBefore.myRegistration.roomId,
      approvedBefore.myRegistration.roomPassword,
    ),
    false,
    'the pre-release response must not provide room credentials',
  );

  assert.match(
    tournamentsSource,
    /getNextRoomCredentialRefreshAtMs\(\s*schedule\.startsAtMs,\s*schedule\.releaseAtMs,\s*tournament\.myRegistration\?\.status,\s*now,\s*\)/,
  );
  assert.match(tournamentsSource, /now=\{clockNow\}/);
  assert.match(roomCredentialsPanelSource, /const credentialsReady = hasServerAuthorizedRoomCredentials\(id, password\)/);
  assert.match(roomCredentialsPanelSource, /\{credentialsReady \? \(/);

  const timers = [];
  const clearedTimers = [];
  let scheduledRefreshCalls = 0;
  let scheduledRefresh = Promise.resolve();
  const lifecycleEffect = loadLifecycleRefreshEffect({
    items: harness.state.items,
    listFocused: { current: true },
    AppState: { currentState: 'active' },
    lifecycleOf: (tournament) => getTournamentLifecycleState(tournament, harness.state.clockNow),
    getRoomCredentialSchedule,
    getNextRoomCredentialRefreshAtMs,
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
    setClockNow: (value) => { harness.state.clockNow = value; },
    setStartAnnouncement() {},
    load: () => {
      scheduledRefreshCalls += 1;
      scheduledRefresh = harness.load();
      return scheduledRefresh;
    },
  });

  const cleanup = lifecycleEffect();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 1_020, 'the next transition should be the approved registration’s T-5 release');
  assert.equal(scheduledRefreshCalls, 0, 'room data must wait for the scheduled timer');

  fakeNow = releaseAtMs + 20;
  timers[0].callback();
  await scheduledRefresh;

  assert.equal(harness.state.clockNow, fakeNow);
  assert.equal(scheduledRefreshCalls, 1, 'the release timer should refresh the screen without a manual action');
  const approvedAfter = harness.state.items.find((tournament) => tournament.id === 'approved-room');
  assert.deepEqual(
    {
      roomId: approvedAfter.myRegistration.roomId,
      roomPassword: approvedAfter.myRegistration.roomPassword,
    },
    {
      roomId: 'ROOM-APPROVED-101',
      roomPassword: 'PASS-APPROVED-101',
    },
  );
  assert.ok(
    hasServerAuthorizedRoomCredentials(
      approvedAfter.myRegistration.roomId,
      approvedAfter.myRegistration.roomPassword,
    ),
    'the refreshed approved registration should now render its room values',
  );
  const pendingAfter = harness.state.items.find((tournament) => tournament.id === 'pending-room');
  assert.equal(pendingAfter.myRegistration.status, 'pending');
  assert.equal(
    hasServerAuthorizedRoomCredentials(
      pendingAfter.myRegistration.roomId,
      pendingAfter.myRegistration.roomPassword,
    ),
    false,
    'an unapproved registration must remain without credentials',
  );

  const selectedTabs = tournamentTabsForRoute(
    harness.state.items,
    { gameMode: selectedMode },
    (tournament) => getTournamentLifecycleState(tournament, harness.state.clockNow),
  );
  assert.ok(Object.values(selectedTabs).flat().some((tournament) => tournament.id === 'approved-room'));
  assert.ok(Object.values(selectedTabs).flat().some((tournament) => tournament.id === 'pending-room'));
  assert.ok(
    Object.values(selectedTabs).flat().every((tournament) => tournament.gameMode === selectedMode),
    'the room release refresh must not expose tournaments from another game mode',
  );

  cleanup();
  assert.deepEqual(clearedTimers, [timers[0]]);
});

test('a registration approved after T-5 receives credentials through a scheduled retry', async () => {
  const startAtMs = Date.parse('2026-10-08T14:00:00.000Z');
  const schedule = getRoomCredentialSchedule(new Date(startAtMs).toISOString());
  assert.ok(schedule);
  let fakeNow = schedule.releaseAtMs - 1_000;
  let registrationStatus = 'pending';
  const harness = createTournamentLoadHarness({
    tournaments: async () => [{
      id: 'pending-room',
      gameMode: 'clash_squad',
      teamType: 'Duo',
      status: 'upcoming',
      startsAt: new Date(startAtMs).toISOString(),
    }],
    myRegistrations: async () => [{
      tournamentId: 'pending-room',
      status: registrationStatus,
      roomPublished: true,
      roomId: registrationStatus === 'approved' && fakeNow >= schedule.releaseAtMs
        ? 'ROOM-LATE-APPROVAL'
        : null,
      roomPassword: registrationStatus === 'approved' && fakeNow >= schedule.releaseAtMs
        ? 'PASS-LATE-APPROVAL'
        : null,
    }],
  }, () => fakeNow);
  await harness.load();
  assert.equal(
    hasServerAuthorizedRoomCredentials(
      harness.state.items[0].myRegistration.roomId,
      harness.state.items[0].myRegistration.roomPassword,
    ),
    false,
  );

  const timers = [];
  const clearedTimers = [];
  let scheduledRefreshCalls = 0;
  let scheduledRefresh = Promise.resolve();
  const lifecycleEffect = loadLifecycleRefreshEffect({
    items: harness.state.items,
    listFocused: { current: true },
    AppState: { currentState: 'active' },
    lifecycleOf: (tournament) => getTournamentLifecycleState(tournament, harness.state.clockNow),
    getRoomCredentialSchedule,
    getNextRoomCredentialRefreshAtMs,
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
    setClockNow: (value) => { harness.state.clockNow = value; },
    setStartAnnouncement() {},
    load: () => {
      scheduledRefreshCalls += 1;
      scheduledRefresh = harness.load();
      return scheduledRefresh;
    },
  });

  const cleanupBeforeRelease = lifecycleEffect();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delayMs, 1_020, 'pending entries should refresh at the T-5 threshold');
  fakeNow = schedule.releaseAtMs + 20;
  timers[0].callback();
  await scheduledRefresh;
  assert.equal(scheduledRefreshCalls, 1);

  const stillPending = harness.state.items[0].myRegistration;
  assert.equal(stillPending.status, 'pending');
  assert.equal(
    hasServerAuthorizedRoomCredentials(stillPending.roomId, stillPending.roomPassword),
    false,
    'the T-5 refresh must not provide credentials while the registration is pending',
  );

  cleanupBeforeRelease();
  const cleanupAfterRelease = lifecycleEffect();
  assert.equal(timers.length, 2);
  assert.equal(
    timers[1].delayMs,
    ROOM_CREDENTIAL_PENDING_REFRESH_INTERVAL_MS + 20,
    'a pending registration past T-5 should be checked again without waiting until match start',
  );

  registrationStatus = 'approved';
  fakeNow += ROOM_CREDENTIAL_PENDING_REFRESH_INTERVAL_MS;
  timers[1].callback();
  await scheduledRefresh;
  assert.equal(scheduledRefreshCalls, 2);
  assert.deepEqual(
    {
      status: harness.state.items[0].myRegistration.status,
      roomId: harness.state.items[0].myRegistration.roomId,
      roomPassword: harness.state.items[0].myRegistration.roomPassword,
    },
    {
      status: 'approved',
      roomId: 'ROOM-LATE-APPROVAL',
      roomPassword: 'PASS-LATE-APPROVAL',
    },
    'the scheduled retry should reveal credentials after the server reports approval',
  );

  cleanupAfterRelease();
  assert.deepEqual(clearedTimers, [timers[0], timers[1]]);
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

test('tournament details survive a failed registration lookup and recover joined status on refresh', async () => {
  let registrationResponse = Promise.reject(new Error('Temporary registration lookup failure'));
  const api = {
    async tournament(id) {
      assert.equal(id, 'detail-recovery-match');
      return { id, name: 'Detail Recovery Match' };
    },
    async myRegistrations() {
      return registrationResponse;
    },
  };

  const unknownSnapshot = await fetchTournamentDetailSnapshot('detail-recovery-match', api);
  assert.equal(unknownSnapshot.name, 'Detail Recovery Match');
  assert.equal(unknownSnapshot.registrationStatusKnown, false);
  assert.equal(unknownSnapshot.joined, null);
  assert.equal(unknownSnapshot.myRegistration, undefined);

  registrationResponse = Promise.resolve([{
    tournamentId: 'detail-recovery-match',
    status: 'approved',
  }]);
  const recoveredSnapshot = await fetchTournamentDetailSnapshot('detail-recovery-match', api);
  assert.equal(recoveredSnapshot.name, 'Detail Recovery Match');
  assert.equal(recoveredSnapshot.registrationStatusKnown, true);
  assert.equal(recoveredSnapshot.joined, true);
  assert.equal(recoveredSnapshot.myRegistration.status, 'approved');
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
      `No ${tab} tournaments are available.\nSelected format: Duo Clash Squad.`,
    );
  }

  assert.equal(
    tournamentListEmptyMessage(false, 'Upcoming'),
    'No upcoming tournaments are available right now.',
    'unfiltered empty lists should retain a clear lifecycle message',
  );
  assert.match(
    tournamentsSource,
    /const emptyMessage = tournamentListEmptyMessage\(false,\s*tabLabel\[tab\],\s*heading,\s*teamType\)/,
  );
  assert.match(
    tournamentsSource,
    /accessibilityLabel=\{emptyMessage\.replace\('\\n', ' '\)\}/,
    'the one visible no-results message should also provide a continuous screen-reader label',
  );
  assert.match(tournamentsSource, /const \{ fontScale \} = useWindowDimensions\(\)/);
  assert.match(tournamentsSource, /const largeText = fontScale >= 1\.5/);
  assert.match(tournamentsSource, /<View style=\{\[s\.tabs, largeText && s\.tabsLarge\]\}>/);
  assert.match(tournamentsSource, /tabsLarge:\s*\{\s*flexDirection: 'column', alignItems: 'stretch'\s*\}/);
  assert.match(tournamentsSource, /tabLarge:\s*\{\s*flex: 0, minHeight: 52, paddingVertical: 10\s*\}/);
  assert.match(
    tournamentsSource,
    /emptyMessage:\s*\{[\s\S]*?width: '100%'[\s\S]*?maxWidth: 520[\s\S]*?flexShrink: 1[\s\S]*?fontSize: 14[\s\S]*?textAlign: 'center'/,
    'the empty-state message should wrap at full width without a fixed height or line limit',
  );
  assert.match(
    tournamentsSource,
    /data=\{orderedVisible\}[\s\S]*?ListEmptyComponent=/,
    'the list should continue to own and scroll its empty state',
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