export const KNOCKOUT_PRIZE_DISTRIBUTION = [
  { rank: 1, squadCoins: 500, playerCoins: 125 },
  { rank: 2, squadCoins: 300, playerCoins: 75 },
  { rank: 3, squadCoins: 200, playerCoins: 50 },
] as const;

export type KnockoutPrizeRecipient = {
  registrationId: string;
  recipientUserId: string;
  playerName: string;
  recipientName: string;
  teamNumber: number;
  slotNumber: number;
  rank: number;
};

export type KnockoutPrizeAward = KnockoutPrizeRecipient & {
  squadPrizeCoins: number;
  playerPrizeCoins: number;
};

export function knockoutPrizeTier(rank: number) {
  return KNOCKOUT_PRIZE_DISTRIBUTION.find((tier) => tier.rank === rank) ?? null;
}

export function buildKnockoutPrizeAwards(
  recipients: KnockoutPrizeRecipient[],
): KnockoutPrizeAward[] {
  const awards: KnockoutPrizeAward[] = [];
  const registrations = new Set<string>();
  const seats = new Set<string>();

  for (const tier of KNOCKOUT_PRIZE_DISTRIBUTION) {
    const ranked = recipients.filter((recipient) => recipient.rank === tier.rank);
    if (ranked.length !== 4) {
      throw new Error(`Rank ${tier.rank} must have exactly four paid squad members.`);
    }
    const teamNumbers = new Set(ranked.map((recipient) => recipient.teamNumber));
    if (teamNumbers.size !== 1) {
      throw new Error(`Rank ${tier.rank} must map to exactly one winning squad.`);
    }
    if (ranked.reduce((sum) => sum + tier.playerCoins, 0) !== tier.squadCoins) {
      throw new Error(`Rank ${tier.rank} prize does not divide evenly among four players.`);
    }

    for (const recipient of ranked) {
      if (
        !recipient.registrationId ||
        !recipient.recipientUserId ||
        !recipient.playerName.trim() ||
        !recipient.recipientName.trim() ||
        !Number.isSafeInteger(recipient.teamNumber) ||
        recipient.teamNumber < 1 ||
        recipient.teamNumber > 12 ||
        !Number.isSafeInteger(recipient.slotNumber) ||
        recipient.slotNumber < 1 ||
        recipient.slotNumber > 4
      ) {
        throw new Error("Each prize recipient must have a valid paid registration, account, and seat.");
      }
      const seat = `${recipient.rank}:${recipient.teamNumber}:${recipient.slotNumber}`;
      if (registrations.has(recipient.registrationId) || seats.has(seat)) {
        throw new Error("A winning registration or squad seat appears more than once.");
      }
      registrations.add(recipient.registrationId);
      seats.add(seat);
      awards.push({
        ...recipient,
        squadPrizeCoins: tier.squadCoins,
        playerPrizeCoins: tier.playerCoins,
      });
    }
  }

  if (awards.length !== 12 || awards.reduce((sum, award) => sum + award.playerPrizeCoins, 0) !== 1000) {
    throw new Error("The top-three prize distribution must credit exactly twelve seats and 1,000 coins.");
  }
  return awards.sort((left, right) =>
    left.rank - right.rank || left.slotNumber - right.slotNumber,
  );
}
