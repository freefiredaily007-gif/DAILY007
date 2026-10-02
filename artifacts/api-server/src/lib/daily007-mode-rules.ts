export type GameModeKey = "battle_royale" | "clash_squad" | "lone_wolf";
export type TeamTypeKey = "solo" | "duo" | "squad";
export type SlotUnit = "player" | "team";

export type TournamentMode = {
  gameMode: GameModeKey;
  gameModeLabel: string;
  teamType: TeamTypeKey;
  teamTypeLabel: string;
  storageMode: "solo" | "squad" | "clash";
  capacity: number;
  teamSize: number;
  slotUnit: SlotUnit;
};

const GAME_MODES: Record<string, { key: GameModeKey; label: string }> = {
  "battle royale": { key: "battle_royale", label: "Battle Royale" },
  battleroyale: { key: "battle_royale", label: "Battle Royale" },
  br: { key: "battle_royale", label: "Battle Royale" },
  battle_royale: { key: "battle_royale", label: "Battle Royale" },
  "clash squad": { key: "clash_squad", label: "Clash Squad" },
  clash: { key: "clash_squad", label: "Clash Squad" },
  cs: { key: "clash_squad", label: "Clash Squad" },
  clash_squad: { key: "clash_squad", label: "Clash Squad" },
  "lone wolf": { key: "lone_wolf", label: "Lone Wolf" },
  lonewolf: { key: "lone_wolf", label: "Lone Wolf" },
  lw: { key: "lone_wolf", label: "Lone Wolf" },
  lone_wolf: { key: "lone_wolf", label: "Lone Wolf" },
};

const TEAM_TYPES: Record<string, { key: TeamTypeKey; label: string; size: number }> = {
  solo: { key: "solo", label: "Solo", size: 1 },
  duo: { key: "duo", label: "Duo", size: 2 },
  squad: { key: "squad", label: "Squad", size: 4 },
};

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[- ]+/g, "_") : "";
}

function lookupGameMode(value: unknown) {
  const key = normalized(value);
  return GAME_MODES[key] ?? GAME_MODES[key.replaceAll("_", " ")] ?? null;
}

function lookupTeamType(value: unknown) {
  const key = normalized(value);
  return TEAM_TYPES[key] ?? null;
}

export function resolveTournamentMode(gameModeValue: unknown, teamTypeValue: unknown): TournamentMode | null {
  let game = lookupGameMode(gameModeValue);
  let team = lookupTeamType(teamTypeValue);
  const rawMode = normalized(gameModeValue);

  // Rows and requests from the earlier API used the storage mode ("solo",
  // "squad", or "clash") instead of a main game mode.
  if (!game && rawMode === "solo") {
    game = GAME_MODES.battle_royale;
    team ??= TEAM_TYPES.solo;
  } else if (!game && rawMode === "squad") {
    game = GAME_MODES.battle_royale;
    team ??= TEAM_TYPES.squad;
  } else if (!game && rawMode === "clash") {
    game = GAME_MODES.clash_squad;
    team ??= TEAM_TYPES.squad;
  }

  if (!game || !team) return null;

  if (game.key === "battle_royale") {
    const capacity = team.key === "solo" ? 48 : team.key === "duo" ? 24 : 12;
    return {
      gameMode: game.key, gameModeLabel: game.label,
      teamType: team.key, teamTypeLabel: team.label,
      storageMode: team.key === "solo" ? "solo" : "squad",
      capacity, teamSize: team.size, slotUnit: team.key === "solo" ? "player" : "team",
    };
  }

  return {
    gameMode: game.key, gameModeLabel: game.label,
    teamType: team.key, teamTypeLabel: team.label,
    storageMode: "clash", capacity: 2, teamSize: team.size, slotUnit: "team",
  };
}

export function legacyTournamentMode(storageMode: string, gameMode?: unknown, teamType?: unknown): TournamentMode {
  const resolved = resolveTournamentMode(gameMode, teamType);
  if (resolved) return resolved;
  if (storageMode === "clash") return resolveTournamentMode("clash_squad", "squad")!;
  if (storageMode === "squad") return resolveTournamentMode("battle_royale", "squad")!;
  return resolveTournamentMode("battle_royale", "solo")!;
}

export function tournamentModeCapacityLabel(mode: Pick<TournamentMode, "gameMode" | "teamType" | "capacity" | "teamSize" | "slotUnit">) {
  const players = mode.capacity * mode.teamSize;
  const slots = `${mode.capacity} ${mode.slotUnit === "player" ? "player slots" : "team slots"}`;
  return mode.slotUnit === "player" ? slots : `${slots} · ${players} players`;
}