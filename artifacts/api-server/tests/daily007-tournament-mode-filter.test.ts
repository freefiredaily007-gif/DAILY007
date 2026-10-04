import assert from "node:assert/strict";
import test from "node:test";

import {
  filterTournamentsForRoute,
  HOME_GAME_MODE_CARDS,
  homeModeRouteParams,
  submodeRouteParams,
  tournamentListEmptyMessage,
} from "../../daily007/src/lib/tournamentFilters";

const apiTournaments = [
  { id: "battle-solo", gameMode: "battle_royale", mode: "Battle Royale", teamType: "Solo" },
  { id: "battle-squad", gameMode: "battle_royale", mode: "Battle Royale", teamType: "SQUAD" },
  { id: "clash-solo", gameMode: "clash_squad", mode: "Clash Squad", teamType: "solo" },
  { id: "lone-duo", gameMode: "", mode: "Lone Wolf", teamType: "Duo" },
];

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