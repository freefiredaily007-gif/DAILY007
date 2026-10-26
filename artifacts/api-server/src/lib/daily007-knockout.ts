export const DEFAULT_KNOCKOUT_SETTINGS = {
  title: "Knockout Squad Tournament",
  squadCount: 12,
  playersPerSquad: 4,
  stageCount: 3,
  entryCoins: 10,
  prizePool: 1000,
  pointsPerKill: 1,
  round1Eliminated: 2,
  round2Eliminated: 2,
} as const;

export type KnockoutStage = {
  name: "Round 1" | "Round 2" | "Final";
  squads: number;
  eliminated: number;
  advance: number;
};

export type KnockoutSettings = {
  title: string;
  startsAt: string;
  squadCount: number;
  playersPerSquad: 4;
  stageCount: 3;
  entryCoins: number;
  prizePool: number;
  pointsPerKill: number;
  round1Eliminated: number;
  round2Eliminated: number;
  published: boolean;
};

export function knockoutStages(
  squadCount: number,
  round1Eliminated: number,
  round2Eliminated: number,
): KnockoutStage[] {
  const round1Advance = squadCount - round1Eliminated;
  const round2Advance = round1Advance - round2Eliminated;
  return [
    { name: "Round 1", squads: squadCount, eliminated: round1Eliminated, advance: round1Advance },
    { name: "Round 2", squads: round1Advance, eliminated: round2Eliminated, advance: round2Advance },
    { name: "Final", squads: round2Advance, eliminated: 0, advance: round2Advance },
  ];
}

function integerField(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

export function parseKnockoutSettings(
  input: unknown,
  options: { now?: number; requireFutureStart?: boolean } = {},
): KnockoutSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Provide valid Knockout tournament settings.");
  }
  const body = input as Record<string, unknown>;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title.length < 3 || title.length > 80) {
    throw new Error("Tournament name must be between 3 and 80 characters.");
  }

  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const startsAtMs = Date.parse(startsAt);
  if (!startsAt || !Number.isFinite(startsAtMs)) {
    throw new Error("Provide a valid tournament start date and time.");
  }
  if (options.requireFutureStart !== false && startsAtMs <= (options.now ?? Date.now())) {
    throw new Error("Tournament start time must be in the future.");
  }

  const squadCount = integerField(body.squadCount, "Total squads", 4, 12);
  const playersPerSquad = integerField(body.playersPerSquad, "Players per squad", 4, 4) as 4;
  const stageCount = integerField(body.stageCount, "Stages", 3, 3) as 3;
  const entryCoins = integerField(body.entryCoins, "Entry fee per player", 0, 2_147_483_647);
  const prizePool = integerField(body.prizePool, "Prize pool", 0, 2_147_483_647);
  const pointsPerKill = integerField(body.pointsPerKill, "Points per kill", 1, 1000);
  const round1Eliminated = integerField(body.round1Eliminated, "Round 1 eliminations", 1, squadCount - 3);
  const round1Advance = squadCount - round1Eliminated;
  const round2Eliminated = integerField(body.round2Eliminated, "Round 2 eliminations", 1, round1Advance - 2);
  if (typeof body.published !== "boolean") {
    throw new Error("Choose whether the tournament is published.");
  }

  return {
    title,
    startsAt: new Date(startsAtMs).toISOString(),
    squadCount,
    playersPerSquad,
    stageCount,
    entryCoins,
    prizePool,
    pointsPerKill,
    round1Eliminated,
    round2Eliminated,
    published: body.published,
  };
}
