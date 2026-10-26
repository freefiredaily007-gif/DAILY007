export const KNOCKOUT_ROUNDS = ["round_1", "round_2", "final"] as const;
export type KnockoutRound = (typeof KNOCKOUT_ROUNDS)[number];

const PLACEMENT_POINTS: Readonly<Record<number, number>> = Object.freeze({
  1: 12,
  2: 9,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
  11: 0,
  12: 0,
});

export type KnockoutRoundResultInput = {
  round: KnockoutRound;
  teamNumber: number;
  placement: number;
  squadKills: number;
};

export type KnockoutSquadSlotPayment = {
  slotNumber: number;
  registrationStatus: string | null;
  entryCoinsPaid: number;
};

export function parseKnockoutRound(value: unknown): KnockoutRound | null {
  return typeof value === "string" && KNOCKOUT_ROUNDS.includes(value as KnockoutRound)
    ? value as KnockoutRound
    : null;
}

export function parseKnockoutRoundResult(
  value: unknown,
): KnockoutRoundResultInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const round = parseKnockoutRound(input.round);
  const teamNumber = input.teamNumber;
  const placement = input.placement;
  const squadKills = input.squadKills;
  if (
    !round ||
    typeof teamNumber !== "number" ||
    !Number.isSafeInteger(teamNumber) ||
    teamNumber < 1 ||
    teamNumber > 12 ||
    typeof placement !== "number" ||
    !Number.isSafeInteger(placement) ||
    placement < 1 ||
    placement > 12 ||
    typeof squadKills !== "number" ||
    !Number.isSafeInteger(squadKills) ||
    squadKills < 0 ||
    squadKills > 100_000
  ) {
    return null;
  }
  return { round, teamNumber, placement, squadKills };
}

export function knockoutPlacementPoints(placement: number): number {
  return PLACEMENT_POINTS[placement] ?? 0;
}

export function calculateKnockoutRoundPoints(
  placement: number,
  squadKills: number,
  pointsPerKill: number,
): number {
  return knockoutPlacementPoints(placement) + squadKills * pointsPerKill;
}

export function knockoutPaymentStatus(
  slot: KnockoutSquadSlotPayment & { hasMember: boolean },
  entryCoins: number,
): "paid" | "pending" | "unpaid" | "open" {
  if (!slot.hasMember) return "open";
  if (slot.registrationStatus === "pending") return "pending";
  if (
    slot.registrationStatus === "approved" &&
    Number.isSafeInteger(slot.entryCoinsPaid) &&
    slot.entryCoinsPaid >= entryCoins
  ) {
    return "paid";
  }
  return "unpaid";
}

export function isKnockoutSquadConfirmed(
  slots: KnockoutSquadSlotPayment[],
  entryCoins: number,
): boolean {
  if (slots.length !== 4) return false;
  const bySlot = new Map(slots.map((slot) => [slot.slotNumber, slot]));
  return [1, 2, 3, 4].every((slotNumber) => {
    const slot = bySlot.get(slotNumber);
    return Boolean(
      slot &&
      slot.registrationStatus === "approved" &&
      Number.isSafeInteger(slot.entryCoinsPaid) &&
      slot.entryCoinsPaid >= entryCoins
    );
  });
}

export function knockoutRoundLabel(round: KnockoutRound): string {
  if (round === "round_1") return "Round 1";
  if (round === "round_2") return "Round 2";
  return "Final";
}
