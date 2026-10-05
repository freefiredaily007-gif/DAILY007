import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  HOME_GAME_MODE_CARDS,
  homeModeRouteParams,
  submodeRouteParams,
  tournamentTabsForRoute,
} from '../src/lib/tournamentFilters.ts';

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
const appSource = await readFile(
  new URL('../src/App.tsx', import.meta.url),
  'utf8',
);

test('Solo and Squad selections keep the selected game mode in their route params', () => {
  for (const teamType of ['solo', 'squad']) {
    assert.deepEqual(
      submodeRouteParams('clash_squad', teamType, 'CLASH SQUAD'),
      {
        gameMode: 'clash_squad',
        teamType,
        gameModeLabel: 'CLASH SQUAD',
      },
    );
  }

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

    const pickerParams = submodeRouteParams(card.gameMode, 'solo', card.mode);
    assert.deepEqual(pickerParams, {
      gameMode: card.gameMode,
      teamType: 'solo',
      gameModeLabel: card.mode,
    });
    const pickerTabs = tournamentTabsForRoute(
      tournaments,
      pickerParams,
      () => 'upcoming',
    );
    assert.deepEqual(
      pickerTabs.upcoming.map((tournament) => tournament.id),
      [`${card.gameMode}-solo`],
    );
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

test('Solo and Squad lists exclude other sizes without losing the selected mode', () => {
  const tournaments = [
    { id: 'clash-solo', gameMode: 'clash_squad', teamType: 'Solo' },
    { id: 'clash-duo', gameMode: 'clash_squad', teamType: 'Duo' },
    { id: 'clash-squad', gameMode: 'clash_squad', teamType: 'Squad' },
    { id: 'battle-solo', gameMode: 'battle_royale', teamType: 'Solo' },
    { id: 'battle-squad', gameMode: 'battle_royale', teamType: 'Squad' },
    { id: 'wolf-squad', gameMode: 'lone_wolf', teamType: 'Squad' },
  ];
  const lifecycleOf = () => 'upcoming';

  for (const [teamType, expectedId] of [
    ['solo', 'clash-solo'],
    ['squad', 'clash-squad'],
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