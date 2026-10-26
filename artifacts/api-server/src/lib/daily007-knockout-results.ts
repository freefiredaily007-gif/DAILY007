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

export type KnockoutStageConfig = {
  squadCount: number;
  round1Eliminated: number;
  round2Eliminated: number;
};

export type KnockoutStageResult = {
  teamNumber: number;
  placement: number;
  placementPoints: number;
  squadKills: number;
  pointsPerKill: number;
  roundPoints: number;
  status: "draft" | "published";
};

export type KnockoutTieDecision = {
  order: number[];
  reason: string;
};

export type KnockoutStageRanking = Omit<KnockoutStageResult, "status"> & {
  rank: number;
  status: "qualified" | "eliminated" | "winner" | "finalist";
  resultStatus: "draft" | "published";
  decisionReason: string | null;
};

export type KnockoutProgressionPreview = {
  expectedSquads: number;
  advanceCount: number;
  eliminatedCount: number;
  finalistCount: number;
  eligibleTeamNumbers: number[];
  publishedResultCount: number;
  allResultsPublished: boolean;
  boundaryTieTeamNumbers: number[];
  canConfirm: boolean;
  rankedResults: KnockoutStageRanking[];
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

export function knockoutStageSpec(
  round: KnockoutRound,
  config: KnockoutStageConfig,
): Omit<KnockoutProgressionPreview, "eligibleTeamNumbers" | "publishedResultCount" | "allResultsPublished" | "boundaryTieTeamNumbers" | "canConfirm" | "rankedResults"> {
  if (
    !Number.isSafeInteger(config.squadCount) ||
    config.squadCount < 4 ||
    config.squadCount > 12 ||
    !Number.isSafeInteger(config.round1Eliminated) ||
    !Number.isSafeInteger(config.round2Eliminated) ||
    config.round1Eliminated < 1 ||
    config.round2Eliminated < 1 ||
    config.squadCount - config.round1Eliminated - config.round2Eliminated < 2
  ) {
    throw new Error("The saved Knockout stage settings cannot advance through all three rounds.");
  }
  const round2Expected = config.squadCount - config.round1Eliminated;
  const finalExpected = round2Expected - config.round2Eliminated;
  if (round === "round_1") {
    return {
      expectedSquads: config.squadCount,
      advanceCount: round2Expected,
      eliminatedCount: config.round1Eliminated,
      finalistCount: 0,
    };
  }
  if (round === "round_2") {
    return {
      expectedSquads: round2Expected,
      advanceCount: finalExpected,
      eliminatedCount: config.round2Eliminated,
      finalistCount: 0,
    };
  }
  const winnerCount = Math.min(3, finalExpected);
  return {
    expectedSquads: finalExpected,
    advanceCount: winnerCount,
    eliminatedCount: 0,
    finalistCount: finalExpected - winnerCount,
  };
}

function compareResults(left: KnockoutStageResult, right: KnockoutStageResult): number {
  return right.roundPoints - left.roundPoints ||
    right.squadKills - left.squadKills ||
    left.placement - right.placement ||
    left.teamNumber - right.teamNumber;
}

function sameRankKey(left: KnockoutStageResult, right: KnockoutStageResult): boolean {
  return left.roundPoints === right.roundPoints &&
    left.squadKills === right.squadKills &&
    left.placement === right.placement;
}

export function assessKnockoutProgression(
  round: KnockoutRound,
  config: KnockoutStageConfig,
  eligibleTeamNumbers: number[],
  results: KnockoutStageResult[],
  tieDecision?: KnockoutTieDecision,
): KnockoutProgressionPreview {
  const spec = knockoutStageSpec(round, config);
  const uniqueEligible = [...new Set(eligibleTeamNumbers)].sort((a, b) => a - b);
  if (uniqueEligible.length !== eligibleTeamNumbers.length) {
    throw new Error("The stage contains duplicate eligible squads.");
  }
  const resultByTeam = new Map<number, KnockoutStageResult>();
  for (const result of results) {
    if (resultByTeam.has(result.teamNumber)) throw new Error("A squad has more than one result in this round.");
    if (result.roundPoints !== calculateKnockoutRoundPoints(result.placement, result.squadKills, result.pointsPerKill)) {
      throw new Error("A saved result has an invalid points total.");
    }
    resultByTeam.set(result.teamNumber, result);
  }
  const eligibleSet = new Set(uniqueEligible);
  const matchingResults = results.filter((result) => eligibleSet.has(result.teamNumber));
  const allResultsPublished =
    uniqueEligible.length === spec.expectedSquads &&
    matchingResults.length === spec.expectedSquads &&
    uniqueEligible.every((teamNumber) => resultByTeam.get(teamNumber)?.status === "published") &&
    results.length === spec.expectedSquads;
  const publishedResultCount = matchingResults.filter((result) => result.status === "published").length;
  const rankedBase = matchingResults.slice().sort(compareResults);

  let boundaryTieTeamNumbers: number[] = [];
  if (allResultsPublished) {
    let start = 0;
    while (start < rankedBase.length) {
      let end = start + 1;
      while (end < rankedBase.length && sameRankKey(rankedBase[start]!, rankedBase[end]!)) end++;
      if (start < spec.advanceCount && end > spec.advanceCount) {
        boundaryTieTeamNumbers = rankedBase.slice(start, end).map((result) => result.teamNumber);
        break;
      }
      start = end;
    }
  }

  let decisionReason: string | null = null;
  let rankedForOutcomes = rankedBase;
  if (boundaryTieTeamNumbers.length) {
    if (tieDecision) {
      const reason = tieDecision.reason.trim();
      const ordered = tieDecision.order;
      const candidateSet = new Set(boundaryTieTeamNumbers);
      if (
        reason.length < 5 ||
        reason.length > 500 ||
        ordered.length !== boundaryTieTeamNumbers.length ||
        new Set(ordered).size !== ordered.length ||
        ordered.some((teamNumber) => !candidateSet.has(teamNumber))
      ) {
        throw new Error("Resolve the tied squads in order and enter a reason of 5–500 characters.");
      }
      const orderIndex = new Map(ordered.map((teamNumber, index) => [teamNumber, index]));
      rankedForOutcomes = rankedBase.slice().sort((left, right) => {
        if (boundaryTieTeamNumbers.includes(left.teamNumber) && boundaryTieTeamNumbers.includes(right.teamNumber)) {
          return orderIndex.get(left.teamNumber)! - orderIndex.get(right.teamNumber)!;
        }
        return compareResults(left, right);
      });
      decisionReason = reason;
    } else if (tieDecision) {
      throw new Error("A tie-break decision was supplied when no elimination boundary is tied.");
    }
  } else if (tieDecision) {
    throw new Error("A tie-break decision was supplied when no elimination boundary is tied.");
  }

  let groupStart = 0;
  const rankedResults: KnockoutStageRanking[] = [];
  while (groupStart < rankedForOutcomes.length) {
    let groupEnd = groupStart + 1;
    while (groupEnd < rankedForOutcomes.length && sameRankKey(rankedForOutcomes[groupStart]!, rankedForOutcomes[groupEnd]!)) {
      groupEnd++;
    }
    const isResolvedBoundaryTie =
      boundaryTieTeamNumbers.length > 0 &&
      groupEnd - groupStart === boundaryTieTeamNumbers.length &&
      boundaryTieTeamNumbers.includes(rankedForOutcomes[groupStart]!.teamNumber) &&
      Boolean(tieDecision);
    for (let index = groupStart; index < groupEnd; index++) {
      const item = rankedForOutcomes[index]!;
      const rank = isResolvedBoundaryTie ? index + 1 : groupStart + 1;
      const status = round === "final"
        ? index < spec.advanceCount ? "winner" : "finalist"
        : index < spec.advanceCount ? "qualified" : "eliminated";
      const { status: resultStatus, ...score } = item;
      rankedResults.push({
        ...score,
        rank,
        status,
        resultStatus,
        decisionReason: isResolvedBoundaryTie ? decisionReason : null,
      });
    }
    groupStart = groupEnd;
  }

  return {
    ...spec,
    eligibleTeamNumbers: uniqueEligible,
    publishedResultCount,
    allResultsPublished,
    boundaryTieTeamNumbers,
    canConfirm: allResultsPublished && (!boundaryTieTeamNumbers.length || Boolean(tieDecision)),
    rankedResults,
  };
}

export function knockoutRoundLabel(round: KnockoutRound): string {
  if (round === "round_1") return "Round 1";
  if (round === "round_2") return "Round 2";
  return "Final";
}
