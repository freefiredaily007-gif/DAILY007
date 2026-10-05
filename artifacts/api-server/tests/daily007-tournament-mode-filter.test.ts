import assert from "node:assert/strict";
import test from "node:test";

import {
  filterTournamentsForRoute,
  HOME_GAME_MODE_CARDS,
  homeModeRouteParams,
  submodeRouteParams,
  tournamentListEmptyMessage,
  tournamentTabsForRoute,
} from "../../daily007/src/lib/tournamentFilters";

const apiTournaments = [
  { id: "battle-solo", gameMode: "battle_royale", mode: "Battle Royale", teamType: "Solo" },
  { id: "battle-squad", gameMode: "battle_royale", mode: "Battle Royale", teamType: "SQUAD" },
  { id: "clash-solo", gameMode: "clash_squad", mode: "Clash Squad", teamType: "solo" },
  { id: "lone-duo", gameMode: "", mode: "Lone Wolf", teamType: "Duo" },
];

const lifecycleTournaments = [
  { id: "battle-upcoming", gameMode: "battle_royale", lifecycle: "upcoming" },
  { id: "battle-ongoing", gameMode: "battle_royale", lifecycle: "ongoing" },
  { id: "battle-completed", gameMode: "battle_royale", lifecycle: "completed" },
  { id: "clash-upcoming", gameMode: "clash_squad", lifecycle: "upcoming" },
  { id: "clash-completed", gameMode: "clash_squad", lifecycle: "completed" },
  { id: "lone-ongoing", gameMode: "lone_wolf", lifecycle: "ongoing" },
] as const;

test("Home game-mode cards pass their matching mode into the tournament list", () => {
  const routes = HOME_GAME_MODE_CARDS.map(homeModeRouteParams);
  assert.deepEqual(routes, [
    { gameMode: "battle_royale", gameModeLabel: "Battle Royale" },
    { gameMode: "clash_squad", gameModeLabel: "Clash Squad" },
    { gameMode: "lone_wolf", gameModeLabel: "Lone Wolf" },
  ]);

  assert.deepEqual(
    routes.map((route) => filterTournamentsForRoute(apiTournaments, route).map((item) => item.id)),
    [["battle-solo", "battle-squad"], ["clash-solo"], ["lone-duo"]],
  );
});

test("switching lifecycle tabs keeps results and counts scoped to each Home game mode", () => {
  const expected = {
    battle_royale: {
      upcoming: ["battle-upcoming"],
      ongoing: ["battle-ongoing"],
      completed: ["battle-completed"],
    },
    clash_squad: {
      upcoming: ["clash-upcoming"],
      ongoing: [],
      completed: ["clash-completed"],
    },
    lone_wolf: {
      upcoming: [],
      ongoing: ["lone-ongoing"],
      completed: [],
    },
  };

  for (const card of HOME_GAME_MODE_CARDS) {
    const tabs = tournamentTabsForRoute(
      lifecycleTournaments,
      homeModeRouteParams(card),
      (tournament) => tournament.lifecycle,
    );
    const expectedTabs = expected[card.gameMode];

    for (const tab of ["upcoming", "ongoing", "completed"] as const) {
      const resultIds = tabs[tab].map((tournament) => tournament.id);
      assert.deepEqual(resultIds, expectedTabs[tab]);
      assert.equal(tabs[tab].length, expectedTabs[tab].length);
      assert.ok(tabs[tab].every((tournament) => tournament.gameMode === card.gameMode));
    }
  }
});

test("Solo, Squad, and Clash Squad cards lead to matching filtered results", () => {
  const routes = [
    submodeRouteParams("battle_royale", "solo", "Battle Royale"),
    submodeRouteParams("battle_royale", "squad", "Battle Royale"),
    homeModeRouteParams(HOME_GAME_MODE_CARDS[1]),
  ];

  assert.deepEqual(
    routes.map((route) => filterTournamentsForRoute(apiTournaments, route).map((item) => item.id)),
    [["battle-solo"], ["battle-squad"], ["clash-solo"]],
  );
});

test("an empty mode-specific result is distinct from an API error", () => {
  const emptyMessage = tournamentListEmptyMessage(false, "Upcoming", "Clash Squad", "Solo");
  const errorMessage = tournamentListEmptyMessage(true, "Upcoming", "Clash Squad", "Solo");

  assert.equal(emptyMessage, "No upcoming Solo Clash Squad tournaments are available right now.");
  assert.equal(errorMessage, "Tournament data is unavailable right now. Pull to refresh and try again.");
  assert.notEqual(emptyMessage, errorMessage);
});