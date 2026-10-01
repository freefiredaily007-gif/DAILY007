import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePaymentReference,
  parseCoinPackages,
  pausedVideoRewardResponse,
  referralCodeForUserId,
} from "../src/lib/daily007-compat-extra-validation.ts";
import {
  awardReferrerForApprovedRecharge,
  classifyReferralRechargeStatus,
  isQualifyingReferralRecharge,
  recordReferralSignup,
} from "../src/lib/daily007-referrals.ts";

test("payment reference normalization is trim-, case-, and Unicode-width-insensitive", () => {
  assert.equal(normalizePaymentReference("  abc-123  "), "ABC-123");
  assert.equal(normalizePaymentReference("ＡＢＣ-１２３"), "ABC-123");
  assert.equal(normalizePaymentReference("AbC-123"), normalizePaymentReference(" abc-123 "));
});

test("coin packages accept unique whole-number amounts within configured purchase limits", () => {
  assert.deepEqual(parseCoinPackages(" 100, 250,1000 ", 100, 5000), [100, 250, 1000]);
  assert.deepEqual(parseCoinPackages("", 100, 5000), []);
  assert.equal(parseCoinPackages("100,100", 100, 5000), null);
  assert.equal(parseCoinPackages("99,500", 100, 5000), null);
  assert.equal(parseCoinPackages("100.5,500", 1, 5000), null);
});

test("referral codes are stable per account and unique across account UUIDs", () => {
  const firstId = "7d160000-0000-4000-8000-000000000001";
  const secondId = "7d160000-0000-4000-8000-000000000002";
  const firstCode = referralCodeForUserId(firstId);
  assert.equal(firstCode, referralCodeForUserId(firstId));
  assert.notEqual(firstCode, referralCodeForUserId(secondId));
  assert.match(firstCode, /^D7[0-9A-F]{32}$/);
});

test("only approved recharge amounts of 50 coins or more qualify", () => {
  assert.equal(isQualifyingReferralRecharge(49), false);
  assert.equal(isQualifyingReferralRecharge(50), true);
  assert.equal(isQualifyingReferralRecharge(500), true);
  assert.equal(isQualifyingReferralRecharge(50.5), false);
});

test("referral dashboard distinguishes pending, below-minimum, and rewarded states", () => {
  assert.equal(classifyReferralRechargeStatus({
    rewarded: false,
    approvedAtLeastMinimum: false,
    pendingAtLeastMinimum: false,
    hasOtherRecharge: false,
  }), "not_started");
  assert.equal(classifyReferralRechargeStatus({
    rewarded: false,
    approvedAtLeastMinimum: false,
    pendingAtLeastMinimum: false,
    hasOtherRecharge: true,
  }), "below_minimum");
  assert.equal(classifyReferralRechargeStatus({
    rewarded: false,
    approvedAtLeastMinimum: false,
    pendingAtLeastMinimum: true,
    hasOtherRecharge: true,
  }), "awaiting_approval");
  assert.equal(classifyReferralRechargeStatus({
    rewarded: false,
    approvedAtLeastMinimum: true,
    pendingAtLeastMinimum: false,
    hasOtherRecharge: false,
  }), "eligible_unrewarded");
  assert.equal(classifyReferralRechargeStatus({
    rewarded: true,
    approvedAtLeastMinimum: true,
    pendingAtLeastMinimum: false,
    hasOtherRecharge: true,
  }), "rewarded");
});

test("new referred accounts receive the 10-coin bonus with an idempotency key", async () => {
  const queries: Array<{ sql: string; values: any[] }> = [];
  const client = {
    async query<T = Record<string, unknown>>(sql: string, values: any[] = []) {
      queries.push({ sql, values });
      if (sql.includes("SELECT user_id FROM daily007_v2_referral_codes")) {
        return { rows: [{ user_id: "referrer-id" }] as T[] };
      }
      if (sql.includes("INSERT INTO daily007_v2_referrals")) {
        return { rows: [{ id: "referral-id" }] as T[] };
      }
      if (sql.includes("SELECT wallet_coins FROM daily007_v2_users")) {
        return { rows: [{ wallet_coins: 3 }] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const result = await recordReferralSignup(client, " d7-referrer ", "referred-id");
  assert.deepEqual(result, { walletCoins: 13, referralId: "referral-id" });
  assert.ok(queries.some(({ sql, values }) =>
    sql.includes("UPDATE daily007_v2_users SET wallet_coins") &&
    values[0] === "referred-id" && values[1] === 13,
  ));
  const bonus = queries.find(({ sql }) => sql.includes("INSERT INTO daily007_v2_wallet_ledger"));
  assert.ok(bonus);
  assert.equal(bonus.values[1], 10);
  assert.equal(bonus.values[3], "daily007-referral-signup:referred-id");
  assert.equal(bonus.values[4].referrerUserId, "referrer-id");
});

test("an approved qualifying recharge credits the referrer once with payment details", async () => {
  const queries: Array<{ sql: string; values: any[] }> = [];
  const client = {
    async query<T = Record<string, unknown>>(sql: string, values: any[] = []) {
      queries.push({ sql, values });
      if (sql.includes("SELECT r.id, r.referrer_user_id")) {
        return {
          rows: [{
            id: "referral-id",
            referrer_user_id: "referrer-id",
            rewarded_at: null,
            referred_name: "New Player",
          }] as T[],
        };
      }
      if (sql.includes("SELECT id FROM daily007_v2_wallet_ledger")) return { rows: [] as T[] };
      if (sql.includes("SELECT wallet_coins FROM daily007_v2_users")) {
        return { rows: [{ wallet_coins: 25 }] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const result = await awardReferrerForApprovedRecharge(client, "referred-id", "payment-id", 50);
  assert.deepEqual(result, { referrerUserId: "referrer-id", walletCoins: 30 });
  const bonus = queries.find(({ sql }) => sql.includes("INSERT INTO daily007_v2_wallet_ledger"));
  assert.ok(bonus);
  assert.equal(bonus.values[1], 5);
  assert.equal(bonus.values[3], "daily007-referral-recharge:referral-id");
  assert.deepEqual(bonus.values[4], {
    referralId: "referral-id",
    referredUserId: "referred-id",
    referredUserName: "New Player",
    qualifyingPaymentId: "payment-id",
    qualifyingRechargeCoins: 50,
  });

  const noAwardQueries: string[] = [];
  const noAwardClient = {
    async query<T = Record<string, unknown>>(sql: string) {
      noAwardQueries.push(sql);
      return { rows: [] as T[] };
    },
  };
  assert.equal(await awardReferrerForApprovedRecharge(noAwardClient, "referred-id", "small-payment", 49), null);
  assert.deepEqual(noAwardQueries, []);
});

test("video rewards explicitly return paused without awarding coins", () => {
  assert.deepEqual(pausedVideoRewardResponse(), {
    rewarded: false,
    coins: 0,
    message: "Video rewards are paused until verified playback is available.",
  });
});