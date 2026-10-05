import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  homeModeRouteParams,
  submodeRouteParams,
  tournamentTabsForRoute,
} from '../src/lib/tournamentFilters.ts';

const modeSubmodesSource = await readFile(
  new URL('../src/screens/ModeSubmodes.tsx', import.meta.url),
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

test('the tournament screen applies both route mode and team type filters', () => {
  assert.match(tournamentsSource, /const gameMode = route\?\.params\?\.gameMode/);
  assert.match(tournamentsSource, /const teamType = route\?\.params\?\.teamType/);
  assert.match(
    tournamentsSource,
    /tournamentTabsForRoute\(items,\s*\{\s*gameMode:\s*gameMode\s*\|\|\s*legacyMode,\s*teamType,\s*\},\s*lifecycleOf\)/,
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