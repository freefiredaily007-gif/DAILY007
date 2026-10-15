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
  TEST_SECOND_PLAYER_ID,
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

test("a stale Full Admin request is rejected after its role changes before the transaction", async () => {
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
    // Simulate another role change committing after authentication but before
    // the mutation transaction checks the actor's current role.
    walletTestDb.demoteUserBeforeNextTransaction(TEST_ADMIN_ID);
    const rejected = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/users/${TEST_SECOND_ADMIN_ID}/role`,
      "PATCH",
      { role: "tournament_admin" },
    );

    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error, "Administrator access is required.");

    const refreshedUsers = await call(origin, TEST_SECOND_ADMIN_ID, "/admin/users", "GET");
    const survivingAdmin = refreshedUsers.body.find((user: any) => user.id === TEST_SECOND_ADMIN_ID);
    assert.equal(survivingAdmin.role, "admin");
    assert.equal(walletTestDb.users.get(TEST_SECOND_ADMIN_ID)?.role, "admin");
  });
});

test("Tournament Admins cannot list, review, or pay payment and withdrawal requests", async () => {
  walletTestDb.reset();
  walletTestDb.users.set(TEST_SECOND_ADMIN_ID, {
    id: TEST_SECOND_ADMIN_ID,
    name: "Tournament Test Admin",
    email: "tournament-admin@example.test",
    role: "tournament_admin",
    wallet_coins: 0,
    phone: null,
    game_uid: null,
    status: "active",
    auth_version: 0,
  });

  await withServer(async (origin) => {
    const payment = await call(origin, TEST_PLAYER_ID, "/payments", "POST", {
      coins: 120,
      payerUpiId: "player@upi",
      txnId: "tournament-admin-denial-test",
    });
    const withdrawal = await call(origin, TEST_PLAYER_ID, "/withdrawals", "POST", {
      coins: 150,
      method: "upi",
      account: "player@upi",
    });
    assert.equal(payment.status, 201);
    assert.equal(withdrawal.status, 201);

    const paymentId = payment.body.id as string;
    const withdrawalId = withdrawal.body.id as string;
    const preparedPayout = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/withdrawals/${withdrawalId}/approve`,
      "POST",
    );
    assert.equal(preparedPayout.status, 200);
    assert.equal(walletTestDb.withdrawals.get(withdrawalId)?.payout_status, "manual_payout_required");

    const paymentBefore = structuredClone(walletTestDb.payments.get(paymentId));
    const withdrawalBefore = structuredClone(walletTestDb.withdrawals.get(withdrawalId));
    const playerBalanceBefore = walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins;
    const ledgerBefore = structuredClone(walletTestDb.ledger);
    const notificationsBefore = structuredClone(walletTestDb.notifications);

    const deniedCalls = await Promise.all([
      call(origin, TEST_SECOND_ADMIN_ID, "/admin/payments", "GET"),
      call(origin, TEST_SECOND_ADMIN_ID, `/admin/payments/${paymentId}/proof-url`, "GET"),
      call(origin, TEST_SECOND_ADMIN_ID, "/admin/withdrawals", "GET"),
      call(origin, TEST_SECOND_ADMIN_ID, `/admin/payments/${paymentId}/approve`, "POST"),
      call(origin, TEST_SECOND_ADMIN_ID, `/admin/payments/${paymentId}/reject`, "POST", {
        reason: "Not authorized",
      }),
      call(origin, TEST_SECOND_ADMIN_ID, `/admin/withdrawals/${withdrawalId}/approve`, "POST"),
      call(origin, TEST_SECOND_ADMIN_ID, `/admin/withdrawals/${withdrawalId}/reject`, "POST", {
        reason: "Not authorized",
      }),
      call(origin, TEST_SECOND_ADMIN_ID, `/admin/withdrawals/${withdrawalId}/payout`, "POST"),
    ]);

    assert.deepEqual(
      deniedCalls.map(({ status }) => status),
      Array(deniedCalls.length).fill(403),
    );
    assert.ok(deniedCalls.every(({ body }) =>
      body.error === "Administrator access is required.",
    ));
    assert.deepEqual(walletTestDb.payments.get(paymentId), paymentBefore);
    assert.deepEqual(walletTestDb.withdrawals.get(withdrawalId), withdrawalBefore);
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, playerBalanceBefore);
    assert.deepEqual(walletTestDb.ledger, ledgerBefore);
    assert.deepEqual(walletTestDb.notifications, notificationsBefore);
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

test("deposit retries cannot create duplicate pending payments or credit coins", async () => {
  walletTestDb.reset({ settings: { coinToMoneyRate: "2.5" } });
  const initialBalance = walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins;
  assert.equal(initialBalance, 700);
  const request = {
    coins: 120,
    payerUpiId: "retry-test@upi",
    txnId: "test-reference-retry-1",
  };

  await withServer(async (origin) => {
    const first = await call(origin, TEST_PLAYER_ID, "/payments", "POST", request);
    assert.equal(first.status, 201);
    assert.equal(first.body.status, "pending");
    assert.equal(walletTestDb.payments.size, 1);
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, initialBalance);
    assert.deepEqual(walletTestDb.ledger, []);

    const identicalRetry = await call(origin, TEST_PLAYER_ID, "/payments", "POST", request);
    assert.equal(identicalRetry.status, 409);
    assert.equal(identicalRetry.body.error, "This payment reference has already been submitted.");
    assert.equal(walletTestDb.payments.size, 1);

    const secondPendingRequest = await call(
      origin,
      TEST_PLAYER_ID,
      "/payments",
      "POST",
      { ...request, txnId: "test-reference-retry-2" },
    );
    assert.equal(secondPendingRequest.status, 409);
    assert.equal(secondPendingRequest.body.error, "You already have a pending coin recharge request.");
    assert.equal(walletTestDb.payments.size, 1);

    const history = await call(origin, TEST_PLAYER_ID, "/my/payments", "GET");
    assert.equal(history.status, 200);
    assert.equal(history.body.length, 1);
    assert.equal(history.body[0].id, first.body.id);
    assert.equal(history.body[0].status, "pending");
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, initialBalance);
    assert.deepEqual(walletTestDb.ledger, []);
  });
});

test("each player can hold one pending deposit without blocking the other", async () => {
  const firstPlayerBalance = 700;
  const secondPlayerBalance = 425;
  walletTestDb.reset({
    playerBalance: firstPlayerBalance,
    settings: { coinToMoneyRate: "2.5" },
  });
  walletTestDb.users.set(TEST_SECOND_PLAYER_ID, {
    id: TEST_SECOND_PLAYER_ID,
    name: "Second Test Player",
    email: "second-player@example.test",
    role: "user",
    wallet_coins: secondPlayerBalance,
    phone: null,
    game_uid: null,
    status: "active",
    auth_version: 0,
  });

  await withServer(async (origin) => {
    const firstPending = await call(origin, TEST_PLAYER_ID, "/payments", "POST", {
      coins: 120,
      payerUpiId: "first-player@upi",
      txnId: "independent-player-deposit-1",
    });
    assert.equal(firstPending.status, 201);
    assert.equal(firstPending.body.status, "pending");
    assert.equal(walletTestDb.payments.size, 1);

    const secondPending = await call(origin, TEST_SECOND_PLAYER_ID, "/payments", "POST", {
      coins: 200,
      payerUpiId: "second-player@upi",
      txnId: "independent-player-deposit-2",
    });
    assert.equal(secondPending.status, 201);
    assert.equal(secondPending.body.status, "pending");
    assert.notEqual(secondPending.body.id, firstPending.body.id);
    assert.equal(walletTestDb.payments.size, 2);

    const firstStored = walletTestDb.payments.get(firstPending.body.id);
    const secondStored = walletTestDb.payments.get(secondPending.body.id);
    assert.equal(firstStored?.user_id, TEST_PLAYER_ID);
    assert.equal(firstStored?.status, "pending");
    assert.equal(firstStored?.reference, "independent-player-deposit-1");
    assert.equal(secondStored?.user_id, TEST_SECOND_PLAYER_ID);
    assert.equal(secondStored?.status, "pending");
    assert.equal(secondStored?.reference, "independent-player-deposit-2");
    assert.equal(walletTestDb.users.get(TEST_PLAYER_ID)?.wallet_coins, firstPlayerBalance);
    assert.equal(walletTestDb.users.get(TEST_SECOND_PLAYER_ID)?.wallet_coins, secondPlayerBalance);
    assert.deepEqual(walletTestDb.ledger, []);

    const firstHistory = await call(origin, TEST_PLAYER_ID, "/my/payments", "GET");
    const secondHistory = await call(origin, TEST_SECOND_PLAYER_ID, "/my/payments", "GET");
    assert.equal(firstHistory.status, 200);
    assert.equal(secondHistory.status, 200);
    assert.deepEqual(
      firstHistory.body.map(({ id, txnId }: { id: string; txnId: string }) => ({ id, txnId })),
      [{ id: firstPending.body.id, txnId: "independent-player-deposit-1" }],
    );
    assert.deepEqual(
      secondHistory.body.map(({ id, txnId }: { id: string; txnId: string }) => ({ id, txnId })),
      [{ id: secondPending.body.id, txnId: "independent-player-deposit-2" }],
    );
    const firstHistoryPayload = JSON.stringify(firstHistory.body);
    const secondHistoryPayload = JSON.stringify(secondHistory.body);
    assert.equal(firstHistoryPayload.includes(secondPending.body.id), false);
    assert.equal(firstHistoryPayload.includes("independent-player-deposit-2"), false);
    assert.equal(secondHistoryPayload.includes(firstPending.body.id), false);
    assert.equal(secondHistoryPayload.includes("independent-player-deposit-1"), false);
  });
});

test("payment history returns only the authenticated player's newest 200 requests", async () => {
  walletTestDb.reset();
  const playerPayments = Array.from({ length: 205 }, (_, index) => ({
    id: `history-player-${String(index).padStart(3, "0")}`,
    userId: TEST_PLAYER_ID,
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
  }));
  const otherPlayerPayments = Array.from({ length: 3 }, (_, index) => ({
    id: `history-other-player-${index}`,
    userId: TEST_SECOND_PLAYER_ID,
    createdAt: new Date(Date.UTC(2027, 0, 1) + index * 1000),
  }));
  walletTestDb.seedPaymentHistory([...playerPayments, ...otherPlayerPayments]);

  await withServer(async (origin) => {
    const history = await call(origin, TEST_PLAYER_ID, "/my/payments", "GET");

    assert.equal(history.status, 200);
    assert.equal(history.body.length, 200);
    assert.deepEqual(
      history.body.map((payment: { id: string }) => payment.id),
      playerPayments.slice(-200).reverse().map(({ id }) => id),
    );
    assert.ok(history.body.every((payment: { id: string }) =>
      walletTestDb.payments.get(payment.id)?.user_id === TEST_PLAYER_ID,
    ));
    for (let index = 1; index < history.body.length; index++) {
      assert.ok(
        Date.parse(history.body[index - 1].createdAt) >= Date.parse(history.body[index].createdAt),
        `payment at index ${index - 1} should be at least as new as the following payment`,
      );
    }
  });
});

test("deposit display prefers the stored rupee amount over a changed conversion rate", () => {
  assert.equal(depositAmountInr(120, 300, 1), "₹300");
  assert.equal(depositAmountInr(120, undefined, 2.5), "₹300");
});

test("deposit rejection preserves its reason and reserves the payment reference", async () => {
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

    const exactReferenceRetry = await call(origin, TEST_PLAYER_ID, "/payments", "POST", {
      coins: 120,
      payerUpiId: "player@upi",
      txnId: "deposit-rejected-1",
    });
    assert.equal(exactReferenceRetry.status, 409);
    assert.equal(exactReferenceRetry.body.error, "This payment reference has already been submitted.");

    const normalizedReferenceRetry = await call(origin, TEST_PLAYER_ID, "/payments", "POST", {
      coins: 120,
      payerUpiId: "player@upi",
      txnId: "  ＤＥＰＯＳＩＴ-ＲＥＪＥＣＴＥＤ-１  ",
    });
    assert.equal(normalizedReferenceRetry.status, 409);
    assert.equal(normalizedReferenceRetry.body.error, "This payment reference has already been submitted.");

    assert.equal(walletTestDb.payments.size, 1);
    assert.deepEqual([...walletTestDb.payments.values()].map((payment) => ({
      id: payment.id,
      status: payment.status,
      reference: payment.reference,
      reference_normalized: payment.reference_normalized,
    })), [{
      id: paymentId,
      status: "rejected",
      reference: "deposit-rejected-1",
      reference_normalized: "DEPOSIT-REJECTED-1",
    }]);

    const playerHistory = await call(origin, TEST_PLAYER_ID, "/my/payments", "GET");
    assert.equal(playerHistory.status, 200);
    assert.equal(playerHistory.body.length, 1);
    assert.equal(playerHistory.body[0].id, paymentId);
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

test("players see only their own pending withdrawal and payout details", async () => {
  walletTestDb.reset();

  await withServer(async (origin) => {
    const firstCreated = await call(origin, TEST_PLAYER_ID, "/withdrawals", "POST", {
      coins: 150,
      method: "upi",
      account: "first-player@upi",
    });
    const secondCreated = await call(origin, TEST_SECOND_PLAYER_ID, "/withdrawals", "POST", {
      coins: 250,
      method: "bank",
      account: "second-player-account-9876",
    });

    assert.equal(firstCreated.status, 201);
    assert.equal(secondCreated.status, 201);
    const firstWithdrawalId = firstCreated.body.id as string;
    const secondWithdrawalId = secondCreated.body.id as string;
    assert.notEqual(firstWithdrawalId, secondWithdrawalId);

    const firstHistory = await call(origin, TEST_PLAYER_ID, "/my/withdrawals", "GET");
    const secondHistory = await call(origin, TEST_SECOND_PLAYER_ID, "/my/withdrawals", "GET");

    assert.equal(firstHistory.status, 200);
    assert.equal(secondHistory.status, 200);
    assert.deepEqual(firstHistory.body, [{
      id: firstWithdrawalId,
      coins: 150,
      method: "upi",
      account: "first-player@upi",
      status: "pending",
      payoutStatus: "not_paid",
      reviewReason: null,
      createdAt: walletTestDb.withdrawals.get(firstWithdrawalId)?.created_at.toISOString(),
      reviewedAt: null,
    }]);
    assert.deepEqual(secondHistory.body, [{
      id: secondWithdrawalId,
      coins: 250,
      method: "bank",
      account: "second-player-account-9876",
      status: "pending",
      payoutStatus: "not_paid",
      reviewReason: null,
      createdAt: walletTestDb.withdrawals.get(secondWithdrawalId)?.created_at.toISOString(),
      reviewedAt: null,
    }]);

    const firstHistoryJson = JSON.stringify(firstHistory.body);
    const secondHistoryJson = JSON.stringify(secondHistory.body);
    assert.equal(firstHistoryJson.includes(secondWithdrawalId), false);
    assert.equal(firstHistoryJson.includes("second-player-account-9876"), false);
    assert.equal(secondHistoryJson.includes(firstWithdrawalId), false);
    assert.equal(secondHistoryJson.includes("first-player@upi"), false);
  });
});

test("players see only their own withdrawal after another request is rejected", async () => {
  walletTestDb.reset();

  await withServer(async (origin) => {
    const firstCreated = await call(origin, TEST_PLAYER_ID, "/withdrawals", "POST", {
      coins: 150,
      method: "upi",
      account: "first-player@upi",
    });
    const secondCreated = await call(origin, TEST_SECOND_PLAYER_ID, "/withdrawals", "POST", {
      coins: 250,
      method: "bank",
      account: "second-player-account-9876",
    });

    assert.equal(firstCreated.status, 201);
    assert.equal(secondCreated.status, 201);
    const firstWithdrawalId = firstCreated.body.id as string;
    const secondWithdrawalId = secondCreated.body.id as string;
    const reviewReason = "Payout account could not be verified.";

    const rejected = await call(
      origin,
      TEST_ADMIN_ID,
      `/admin/withdrawals/${firstWithdrawalId}/reject`,
      "POST",
      { reason: reviewReason },
    );
    assert.equal(rejected.status, 200);

    const firstHistory = await call(origin, TEST_PLAYER_ID, "/my/withdrawals", "GET");
    const secondHistory = await call(origin, TEST_SECOND_PLAYER_ID, "/my/withdrawals", "GET");
    const firstWithdrawal = firstHistory.body[0];
    const secondWithdrawal = secondHistory.body[0];

    assert.equal(firstHistory.status, 200);
    assert.deepEqual(firstHistory.body, [{
      id: firstWithdrawalId,
      coins: 150,
      method: "upi",
      account: "first-player@upi",
      status: "rejected",
      payoutStatus: "not_paid",
      reviewReason,
      createdAt: walletTestDb.withdrawals.get(firstWithdrawalId)?.created_at.toISOString(),
      reviewedAt: walletTestDb.withdrawals.get(firstWithdrawalId)?.reviewed_at?.toISOString(),
    }]);
    assert.equal(secondHistory.status, 200);
    assert.deepEqual(secondHistory.body, [{
      id: secondWithdrawalId,
      coins: 250,
      method: "bank",
      account: "second-player-account-9876",
      status: "pending",
      payoutStatus: "not_paid",
      reviewReason: null,
      createdAt: walletTestDb.withdrawals.get(secondWithdrawalId)?.created_at.toISOString(),
      reviewedAt: null,
    }]);
    assert.equal(JSON.stringify(firstHistory.body).includes(secondWithdrawalId), false);
    assert.equal(JSON.stringify(firstHistory.body).includes("second-player-account-9876"), false);
    assert.equal(JSON.stringify(firstHistory.body).includes(reviewReason), true);
    assert.equal(JSON.stringify(secondHistory.body).includes(firstWithdrawalId), false);
    assert.equal(JSON.stringify(secondHistory.body).includes("first-player@upi"), false);
    assert.equal(JSON.stringify(secondHistory.body).includes(reviewReason), false);
    assert.equal(firstWithdrawal.account, "first-player@upi");
    assert.equal(firstWithdrawal.status, "rejected");
    assert.equal(secondWithdrawal.account, "second-player-account-9876");
    assert.equal(secondWithdrawal.status, "pending");
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