import { referralCodeForUserId } from "./daily007-compat-extra-validation.ts";

export const REFERRAL_SIGNUP_BONUS_COINS = 10;
export const REFERRER_RECHARGE_BONUS_COINS = 5;
export const MIN_REFERRAL_RECHARGE_COINS = 50;

const MAX_WALLET_COINS = 2_147_483_647;

type ReferralTransactionClient = {
  query<T = Record<string, unknown>>(
    text: string,
    values?: any[],
  ): Promise<{ rows: T[] }>;
};

function requestError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

export function isQualifyingReferralRecharge(coins: number): boolean {
  return Number.isSafeInteger(coins) && coins >= MIN_REFERRAL_RECHARGE_COINS;
}

export function classifyReferralRechargeStatus(input: {
  rewarded: boolean;
  approvedAtLeastMinimum: boolean;
  pendingAtLeastMinimum: boolean;
  hasOtherRecharge: boolean;
}): "rewarded" | "eligible_unrewarded" | "awaiting_approval" | "below_minimum" | "not_started" {
  if (input.rewarded) return "rewarded";
  if (input.approvedAtLeastMinimum) return "eligible_unrewarded";
  if (input.pendingAtLeastMinimum) return "awaiting_approval";
  if (input.hasOtherRecharge) return "below_minimum";
  return "not_started";
}

export async function ensureDaily007ReferralCode(
  client: ReferralTransactionClient,
  userId: string,
): Promise<string> {
  const generatedCode = referralCodeForUserId(userId);
  await client.query(
    `INSERT INTO daily007_v2_referral_codes (user_id, code)
     VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`,
    [userId, generatedCode],
  );
  const saved = await client.query<{ code: string }>(
    "SELECT code FROM daily007_v2_referral_codes WHERE user_id = $1",
    [userId],
  );
  if (!saved.rows[0]) throw new Error("Could not create a referral code for this account.");
  return saved.rows[0].code;
}

export async function recordReferralSignup(
  client: ReferralTransactionClient,
  referralCodeInput: string | null,
  referredUserId: string,
): Promise<{ walletCoins: number; referralId: string } | null> {
  const code = referralCodeInput?.trim().toUpperCase() || null;
  if (!code) return null;

  const referrerResult = await client.query<{ user_id: string }>(
    "SELECT user_id FROM daily007_v2_referral_codes WHERE code = $1 FOR KEY SHARE",
    [code],
  );
  const referrerUserId = referrerResult.rows[0]?.user_id;
  if (!referrerUserId) throw requestError(400, "Referral code is not recognized.");
  if (referrerUserId === referredUserId) {
    throw requestError(400, "You cannot use your own referral code.");
  }

  const referral = await client.query<{ id: string }>(
    `INSERT INTO daily007_v2_referrals (referrer_user_id, referred_user_id, code)
     VALUES ($1, $2, $3) RETURNING id`,
    [referrerUserId, referredUserId, code],
  );
  const referralId = referral.rows[0]?.id;
  if (!referralId) throw new Error("The referral relationship could not be saved.");

  const account = await client.query<{ wallet_coins: number }>(
    "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    [referredUserId],
  );
  const balance = account.rows[0]?.wallet_coins;
  if (!Number.isSafeInteger(balance) || balance! < 0 ||
      balance! > MAX_WALLET_COINS - REFERRAL_SIGNUP_BONUS_COINS) {
    throw requestError(409, "Referral bonus would exceed the supported wallet balance.");
  }

  const walletCoins = balance! + REFERRAL_SIGNUP_BONUS_COINS;
  await client.query(
    "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
    [referredUserId, walletCoins],
  );
  await client.query(
    `INSERT INTO daily007_v2_wallet_ledger
       (user_id, amount, balance_after, reason, idempotency_key, details)
     VALUES ($1, $2, $3, 'Referral Signup Bonus', $4, $5)`,
    [
      referredUserId,
      REFERRAL_SIGNUP_BONUS_COINS,
      walletCoins,
      `daily007-referral-signup:${referredUserId}`,
      { referrerUserId, referralId, referralCode: code },
    ],
  );

  return { walletCoins, referralId };
}

export async function awardReferrerForApprovedRecharge(
  client: ReferralTransactionClient,
  referredUserId: string,
  paymentId: string,
  rechargeCoins: number,
): Promise<{ referrerUserId: string; walletCoins: number } | null> {
  if (!isQualifyingReferralRecharge(rechargeCoins)) return null;

  const referralResult = await client.query<{
    id: string;
    referrer_user_id: string;
    rewarded_at: Date | string | null;
    referred_name: string;
  }>(
    `SELECT r.id, r.referrer_user_id, r.rewarded_at, u.name AS referred_name
       FROM daily007_v2_referrals r
       JOIN daily007_v2_users u ON u.id = r.referred_user_id
      WHERE r.referred_user_id = $1
      FOR UPDATE OF r`,
    [referredUserId],
  );
  const referral = referralResult.rows[0];
  if (!referral) return null;
  if (referral.rewarded_at) return null;

  const idempotencyKey = `daily007-referral-recharge:${referral.id}`;
  const priorReward = await client.query<{ id: string }>(
    "SELECT id FROM daily007_v2_wallet_ledger WHERE idempotency_key = $1",
    [idempotencyKey],
  );
  if (priorReward.rows[0]) {
    await client.query(
      "UPDATE daily007_v2_referrals SET rewarded_at = COALESCE(rewarded_at, now()) WHERE id = $1",
      [referral.id],
    );
    return null;
  }

  const referrer = await client.query<{ wallet_coins: number }>(
    "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
    [referral.referrer_user_id],
  );
  const balance = referrer.rows[0]?.wallet_coins;
  if (!Number.isSafeInteger(balance) || balance! < 0 ||
      balance! > MAX_WALLET_COINS - REFERRER_RECHARGE_BONUS_COINS) {
    throw requestError(409, "Referral reward would exceed the referrer's supported wallet balance.");
  }

  const walletCoins = balance! + REFERRER_RECHARGE_BONUS_COINS;
  await client.query(
    "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
    [referral.referrer_user_id, walletCoins],
  );
  await client.query(
    `INSERT INTO daily007_v2_wallet_ledger
       (user_id, amount, balance_after, reason, idempotency_key, details)
     VALUES ($1, $2, $3, 'Referral Recharge Bonus', $4, $5)`,
    [
      referral.referrer_user_id,
      REFERRER_RECHARGE_BONUS_COINS,
      walletCoins,
      idempotencyKey,
      {
        referralId: referral.id,
        referredUserId,
        referredUserName: referral.referred_name,
        qualifyingPaymentId: paymentId,
        qualifyingRechargeCoins: rechargeCoins,
      },
    ],
  );
  await client.query(
    "UPDATE daily007_v2_referrals SET rewarded_at = now() WHERE id = $1 AND rewarded_at IS NULL",
    [referral.id],
  );

  return { referrerUserId: referral.referrer_user_id, walletCoins };
}