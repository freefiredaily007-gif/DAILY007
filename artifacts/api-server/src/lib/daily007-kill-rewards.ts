export const MAX_KILL_EARN_RATE = 100;
export const MAX_VERIFIED_KILLS_PER_PLAYER = 47;

export type VerifiedPlayerKills = {
  registrationId: string;
  kills: number;
};

export function killRewardAmount(kills: number, coinsPerKill: number): number {
  if (
    !Number.isSafeInteger(kills) ||
    kills < 0 ||
    kills > MAX_VERIFIED_KILLS_PER_PLAYER ||
    !Number.isSafeInteger(coinsPerKill) ||
    coinsPerKill < 0 ||
    coinsPerKill > MAX_KILL_EARN_RATE
  ) {
    throw new RangeError("Kill reward inputs are outside the supported range.");
  }

  const amount = kills * coinsPerKill;
  if (!Number.isSafeInteger(amount) || amount > MAX_VERIFIED_KILLS_PER_PLAYER * MAX_KILL_EARN_RATE) {
    throw new RangeError("Kill reward exceeds the supported per-player payout cap.");
  }
  return amount;
}

export function killRewardStatus(input: {
  isKillEarn: boolean;
  kills: number;
  coinsPerKill: number;
  paidCoins: number;
}): "paid" | "not_paid" | "no_bonus" {
  if (!input.isKillEarn || input.kills === 0 || input.coinsPerKill === 0) return "no_bonus";
  return input.paidCoins > 0 ? "paid" : "not_paid";
}
