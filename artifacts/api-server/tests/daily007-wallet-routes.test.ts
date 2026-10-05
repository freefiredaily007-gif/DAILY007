import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { depositAmountInr } from "../../daily007/src/lib/coins";

import { makeToken } from "../src/lib/daily007-session-token";
import router from "../src/routes/daily007-compat-extra";
import {
  TEST_ADMIN_ID,
  TEST_PLAYER_ID,
  TEST_SECOND_ADMIN_ID,
  walletTestDb,
} from "./support/daily007-wallet-test-db";

const TEST_AUTH_SECRET = "wallet-route-tests-only-secret-value-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(router);

  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
    listeningServer.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function call(
  origin: string,
  actorId: string,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
): Promise<JsonResult> {
  const token = makeToken(actorId, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

test("a stale admin request cannot remove the last Full Admin, and the row remains Full Admin after reload", async () => {
  walletTestDb.reset();
  walletTestDb.users.set(TEST_SECOND_ADMIN_ID, {
    id: TEST_SECOND_ADMIN_ID,
    name: "Second Test Admin",
    email: "second-admin@example.test",
    role: "admin",
    wallet_coins: 0,
    phone: null,
    game_uid: null,
    status: "active",
    auth_version: 0,
  });

  await withServer(async (origin) => {
    // Simulate another authorized role change committing after this request's
    // authentication check but before its transaction acquires the admin lock.
    walletTestDb.demoteUserBeforeNextTransaction(TEST_ADMIN_ID);
    const rejected = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/users/${TEST_SECOND_ADMIN_ID}/role`,
      "PATCH",
      { role: "tournament_admin" },
    );

    assert.equal(rejected.status, 409);
    assert.equal(rejected.body.error, "At least one full administrator must remain.");

    const refreshedUsers = await call(origin, TEST_SECOND_ADMIN_ID, "/admin/users", "GET");
    const survivingAdmin = refreshedUsers.body.find((user: any) => user.id === TEST_SECOND_ADMIN_ID);
    assert.equal(survivingAdmin.role, "admin");
    assert.equal(walletTestDb.users.get(TEST_SECOND_ADMIN_ID)?.role, "admin");
  });
});

test("pending deposits do not change coins and approval credits the configured amount once", async () => {
  walletTestDb.reset({ settings: { coinToMoneyRate: "2.5" } });

  await withServer(async (origin) => {
    const pending = await call(origin, TEST_PLAYER_ID, "/payments", "POST", {
      coins: 120,
      payerUpiId: "player@upi",
      txnId: "deposit-approved-1",
    });
    assert.equal(pending.status, 201);
    assert.equal(pending.body.coins, 120);
    assert.equal(pending.body.amount, 300);
    assert.equal(pending.body.status, "pending");
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, 700);
    assert.equal(walletTestDb.ledger.length, 0);
    assert.equal(walletTestDb.notifications.length, 0);

    const paymentId = pending.body.id as string;
    const approved = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/payments/${paymentId}/approve`,
      "POST",
    );
    assert.equal(approved.status, 200);
    const repeatedApproval = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/payments/${paymentId}/approve`,
      "POST",
    );
    assert.equal(repeatedApproval.status, 200);
    assert.equal(repeatedApproval.body.alreadyReviewed, true);

    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, 820);
    assert.deepEqual(walletTestDb.ledger, [{
      userId: TEST_PLAYER_ID,
      amount: 120,
      balanceAfter: 820,
      reason: "payment_approved",
    }]);
    assert.equal(walletTestDb.payments.get(paymentId)?.status, "approved");
    assert.equal(walletTestDb.notifications.length, 1);
    assert.equal(walletTestDb.notifications[0].title, "Coin deposit approved");
    assert.match(walletTestDb.notifications[0].body, /120 coins have been added/);

    const playerHistory = await call(origin, TEST_PLAYER_ID, "/my/payments", "GET");
    assert.equal(playerHistory.status, 200);
    assert.equal(playerHistory.body[0].coins, 120);
    assert.equal(playerHistory.body[0].amount, 300);
    assert.equal(playerHistory.body[0].status, "approved");
    assert.equal(
      depositAmountInr(playerHistory.body[0].coins, playerHistory.body[0].amount, 1),
      "₹300",
    );
  });
});

test("deposit display prefers the stored rupee amount over a changed conversion rate", () => {
  assert.equal(depositAmountInr(120, 300, 1), "₹300");
  assert.equal(depositAmountInr(120, undefined, 2.5), "₹300");
});

test("deposit rejection preserves its reason without crediting coins, including on retry", async () => {
  walletTestDb.reset({ settings: { coinToMoneyRate: "2.5" } });
  const initialBalance = walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins;
  assert.equal(initialBalance, 700);

  await withServer(async (origin) => {
    const pending = await call(origin, TEST_PLAYER_ID, "/payments", "POST", {
      coins: 120,
      payerUpiId: "player@upi",
      txnId: "deposit-rejected-1",
    });
    assert.equal(pending.status, 201);
    assert.equal(pending.body.coins, 120);
    assert.equal(pending.body.amount, 300);
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, initialBalance);
    assert.deepEqual(walletTestDb.ledger, []);

    const paymentId = pending.body.id as string;
    const reason = "The transfer could not be verified.";
    const rejected = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/payments/${paymentId}/reject`,
      "POST",
      { reason },
    );
    assert.equal(rejected.status, 200);
    const repeatedRejection = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/payments/${paymentId}/reject`,
      "POST",
      { reason },
    );
    assert.equal(repeatedRejection.status, 200);
    assert.equal(repeatedRejection.body.alreadyReviewed, true);

    const playerHistory = await call(origin, TEST_PLAYER_ID, "/my/payments", "GET");
    assert.equal(playerHistory.status, 200);
    const rejectedDeposit = playerHistory.body[0];
    assert.equal(rejectedDeposit.coins, 120);
    assert.equal(rejectedDeposit.amount, 300);
    assert.equal(rejectedDeposit.status, "rejected");
    assert.equal(rejectedDeposit.reviewReason, reason);
    assert.equal(
      depositAmountInr(rejectedDeposit.coins, rejectedDeposit.amount, 2.5),
      "₹300",
    );
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, initialBalance);
    assert.deepEqual(walletTestDb.ledger, []);
    assert.equal(walletTestDb.notifications.length, 1);
    assert.match(walletTestDb.notifications[0].body, new RegExp(reason));
  });
});

test("withdrawal limits reject invalid requests and rejection refunds a valid reservation once", async () => {
  walletTestDb.reset({ playerBalance: 700, settings: { maxWithdrawal: "5000" } });

  await withServer(async (origin) => {
    const belowMinimum = await call(origin, TEST_PLAYER_ID, "/withdrawals", "POST", {
      coins: 99,
      method: "upi",
      account: "player@upi",
    });
    const aboveMaximum = await call(origin, TEST_PLAYER_ID, "/withdrawals", "POST", {
      coins: 5001,
      method: "upi",
      account: "player@upi",
    });
    assert.equal(belowMinimum.status, 400);
    assert.equal(aboveMaximum.status, 400);
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, 700);
    assert.equal(walletTestDb.withdrawals.size, 0);
    assert.equal(walletTestDb.ledger.length, 0);

    const created = await call(origin, TEST_PLAYER_ID, "/withdrawals", "POST", {
      coins: 150,
      method: "upi",
      account: "player@upi",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.walletCoins, 550);
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, 550);
    assert.deepEqual(walletTestDb.ledger, [{
      userId: TEST_PLAYER_ID,
      amount: -150,
      balanceAfter: 550,
      reason: "withdrawal_reserved",
    }]);

    const withdrawalId = created.body.id as string;
    const reason = "Payout details could not be verified.";
    const rejected = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/withdrawals/${withdrawalId}/reject`,
      "POST",
      { reason },
    );
    assert.equal(rejected.status, 200);
    const repeatedRejection = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/withdrawals/${withdrawalId}/reject`,
      "POST",
      { reason },
    );
    assert.equal(repeatedRejection.status, 200);
    assert.equal(repeatedRejection.body.alreadyReviewed, true);

    const playerHistory = await call(origin, TEST_PLAYER_ID, "/my/withdrawals", "GET");
    assert.equal(playerHistory.status, 200);
    assert.equal(playerHistory.body[0].status, "rejected");
    assert.equal(playerHistory.body[0].reviewReason, reason);
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, 700);
    assert.equal(walletTestDb.ledger.length, 2);
    assert.deepEqual(walletTestDb.ledger[1], {
      userId: TEST_PLAYER_ID,
      amount: 150,
      balanceAfter: 700,
      reason: "withdrawal_rejected_refund",
    });
    assert.equal(walletTestDb.notifications.length, 1);
    assert.match(walletTestDb.notifications[0].body, /coins were refunded/);
  });
});

test("approved withdrawals stay manual and recording a payout is idempotent", async () => {
  walletTestDb.reset();

  await withServer(async (origin) => {
    const created = await call(origin, TEST_PLAYER_ID, "/withdrawals", "POST", {
      coins: 150,
      method: "upi",
      account: "player@upi",
    });
    assert.equal(created.status, 201);
    const withdrawalId = created.body.id as string;

    const approved = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/withdrawals/${withdrawalId}/approve`,
      "POST",
    );
    assert.equal(approved.status, 200);
    assert.equal(walletTestDb.withdrawals.get(withdrawalId)?.status, "approved");
    assert.equal(walletTestDb.withdrawals.get(withdrawalId)?.payout_status, "manual_payout_required");
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, 550);
    assert.equal(walletTestDb.ledger.length, 1);

    const firstPayout = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/withdrawals/${withdrawalId}/payout`,
      "POST",
    );
    const repeatedPayout = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/withdrawals/${withdrawalId}/payout`,
      "POST",
    );
    assert.equal(firstPayout.status, 200);
    assert.equal(firstPayout.body.payoutStatus, "paid");
    assert.equal(repeatedPayout.status, 200);
    assert.equal(repeatedPayout.body.alreadyRecorded, true);

    const playerHistory = await call(origin, TEST_PLAYER_ID, "/my/withdrawals", "GET");
    assert.equal(playerHistory.body[0].status, "approved");
    assert.equal(playerHistory.body[0].payoutStatus, "paid");
    assert.equal(walletTestDb.withdrawals.get(withdrawalId)?.payout_status, "paid");
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, 550);
    assert.equal(walletTestDb.ledger.length, 1);
    assert.deepEqual(walletTestDb.ledger[0], {
      userId: TEST_PLAYER_ID,
      amount: -150,
      balanceAfter: 550,
      reason: "withdrawal_reserved",
    });
    assert.equal(walletTestDb.notifications.length, 2);
    assert.equal(
      walletTestDb.notifications.filter((notification) => notification.title === "Withdrawal paid").length,
      1,
    );
  });
});