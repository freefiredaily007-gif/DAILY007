import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidYoutubeChannelUrl,
  normalizePaymentReference,
  parseCoinPackages,
  pausedVideoRewardResponse,
  referralCodeForUserId,
} from "../src/lib/daily007-compat-extra-validation.ts";
import {
  awardDaily007SignupBonus,
  awardReferrerForApprovedRecharge,
  classifyReferralRechargeStatus,
  isQualifyingReferralRecharge,
} from "../src/lib/daily007-referrals.ts";
import {
  reviewYoutubeSubscribeClaim,
  submitYoutubeSubscribeClaim,
} from "../src/lib/daily007-youtube-subscribe.ts";

test("YouTube task URLs only accept secure YouTube hosts with a channel path", () => {
  assert.equal(isValidYoutubeChannelUrl("https://youtube.com/@freefiredaily007?si=abc"), true);
  assert.equal(isValidYoutubeChannelUrl("https://www.youtube.com/@freefiredaily007"), true);
  assert.equal(isValidYoutubeChannelUrl("http://youtube.com/@freefiredaily007"), false);
  assert.equal(isValidYoutubeChannelUrl("https://youtube.example/@freefiredaily007"), false);
  assert.equal(isValidYoutubeChannelUrl("https://youtube.com"), false);
});

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

  const result = await awardDaily007SignupBonus(client, " d7-referrer ", "referred-id");
  assert.equal(result, 13);
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

test("new accounts without a referral receive one idempotent 10-coin welcome bonus", async () => {
  const queries: Array<{ sql: string; values: any[] }> = [];
  const bonuses: any[][] = [];
  let balance = 3;
  let bonusRecorded = false;
  const client = {
    async query<T = Record<string, unknown>>(sql: string, values: any[] = []) {
      queries.push({ sql, values });
      if (sql.includes("SELECT wallet_coins FROM daily007_v2_users")) {
        return { rows: [{ wallet_coins: balance }] as T[] };
      }
      if (sql.includes("SELECT id FROM daily007_v2_wallet_ledger WHERE idempotency_key")) {
        return { rows: bonusRecorded ? [{ id: "welcome-bonus-id" }] as T[] : [] as T[] };
      }
      if (sql.includes("UPDATE daily007_v2_users SET wallet_coins")) {
        balance = values[1] as number;
        return { rows: [] as T[] };
      }
      if (sql.includes("INSERT INTO daily007_v2_wallet_ledger")) {
        bonuses.push(values);
        bonusRecorded = true;
      }
      return { rows: [] as T[] };
    },
  };

  const firstAward = await awardDaily007SignupBonus(client, null, "new-user-id");
  const retryAward = await awardDaily007SignupBonus(client, null, "new-user-id");
  assert.equal(firstAward, 13);
  assert.equal(retryAward, 13);
  assert.equal(balance, 13);
  assert.equal(bonuses.length, 1);
  assert.equal(bonuses[0][1], 10);
  assert.equal(bonuses[0][2], 13);
  assert.equal(bonuses[0][3], "daily007-welcome-signup:new-user-id");
  assert.ok(queries.some(({ sql }) => sql.includes("'Welcome Signup Bonus'")));
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

test("YouTube task submission returns an existing pending claim instead of duplicating it", async () => {
  const row = {
    id: "claim-id",
    user_id: "user-id",
    task_key: "youtube_subscribe",
    reward_coins: 2,
    status: "pending",
    review_reason: null,
    reviewed_by: null,
    reward_ledger_id: null,
    created_at: new Date("2026-10-01T12:00:00.000Z"),
    reviewed_at: null,
  };
  const queries: string[] = [];
  const client = {
    async query<T = unknown>(sql: string) {
      queries.push(sql);
      if (sql.includes("status = 'approved'")) return { rows: [] as T[] };
      if (sql.includes("status = 'pending'")) return { rows: [row] as T[] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const result = await submitYoutubeSubscribeClaim(client, "user-id", 2);
  assert.equal(result.created, false);
  assert.equal(result.claim.id, "claim-id");
  assert.equal(result.claim.status, "pending");
  assert.equal(queries.some((sql) => sql.includes("INSERT INTO")), false);
});

test("admin approval adds the configured coins and records one idempotent wallet transaction", async () => {
  const row: any = {
    id: "claim-id",
    user_id: "user-id",
    task_key: "youtube_subscribe",
    reward_coins: 2,
    status: "pending",
    review_reason: null,
    reviewed_by: null,
    reward_ledger_id: null,
    created_at: new Date("2026-10-01T12:00:00.000Z"),
    reviewed_at: null,
  };
  let balance = 7;
  let ledgerWrites = 0;
  let balanceWrites = 0;
  const client = {
    async query<T = unknown>(sql: string, values: any[] = []) {
      if (sql.includes("SELECT * FROM daily007_v2_youtube_subscribe_claims WHERE id")) {
        return { rows: [{ ...row }] as T[] };
      }
      if (sql.includes("SELECT id FROM daily007_v2_youtube_subscribe_claims")) {
        return { rows: [] as T[] };
      }
      if (sql.includes("SELECT wallet_coins FROM daily007_v2_users")) {
        return { rows: [{ wallet_coins: balance }] as T[] };
      }
      if (sql.includes("SELECT id FROM daily007_v2_wallet_ledger")) {
        return { rows: [] as T[] };
      }
      if (sql.includes("UPDATE daily007_v2_users SET wallet_coins")) {
        balance = values[1];
        balanceWrites += 1;
        return { rows: [] as T[] };
      }
      if (sql.includes("INSERT INTO daily007_v2_wallet_ledger")) {
        ledgerWrites += 1;
        return { rows: [{ id: "ledger-id" }] as T[] };
      }
      if (sql.includes("UPDATE daily007_v2_youtube_subscribe_claims")) {
        Object.assign(row, {
          status: "approved",
          reviewed_by: values[1],
          reviewed_at: new Date("2026-10-01T12:05:00.000Z"),
          review_reason: null,
          reward_ledger_id: values[2],
        });
        return { rows: [{ ...row }] as T[] };
      }
      return { rows: [] as T[] };
    },
  };

  const result = await reviewYoutubeSubscribeClaim(client, "claim-id", "admin-id", "approve", null);
  assert.equal(result.status, "approved");
  assert.equal(result.rewardCoins, 2);
  assert.equal(result.transactionId, "ledger-id");
  assert.equal(result.walletCoins, 9);
  assert.equal(balance, 9);
  assert.equal(balanceWrites, 1);
  assert.equal(ledgerWrites, 1);

  const repeated = await reviewYoutubeSubscribeClaim(client, "claim-id", "admin-id", "approve", null);
  assert.equal(repeated.status, "approved");
  assert.equal(balanceWrites, 1);
  assert.equal(ledgerWrites, 1);
});