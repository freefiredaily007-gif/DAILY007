import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after, before } from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import router from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "wallet-reference-postgres-test-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

const testDatabaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const testDatabasePort = process.env.DAILY007_TEST_POSTGRES_PORT;
if (
  process.env.DAILY007_ISOLATED_POSTGRES_TEST !== "1" ||
  !testDatabaseUrl ||
  testDatabaseUrl.hostname !== "127.0.0.1" ||
  testDatabaseUrl.pathname !== "/postgres" ||
  testDatabaseUrl.port !== testDatabasePort
) {
  throw new Error("This integration test must run through the isolated PostgreSQL test runner.");
}

const fixture = {
  playerId: randomUUID(),
  payerUpiValidationPlayerId: randomUUID(),
  retryPlayerId: randomUUID(),
  protectedDepositPlayerId: randomUUID(),
  approvedReferencePlayerId: randomUUID(),
  approvedReferenceRetryPlayerId: randomUUID(),
  approvedReferenceSecondRetryPlayerId: randomUUID(),
  concurrentApprovalPlayerId: randomUUID(),
  oppositeReviewPlayerId: randomUUID(),
  racePlayerIds: [randomUUID(), randomUUID()] as const,
  adminId: randomUUID(),
  secondAdminId: randomUUID(),
};

after(async () => {
  try {
    const playerIds = [
      fixture.playerId,
      fixture.payerUpiValidationPlayerId,
      fixture.retryPlayerId,
      fixture.protectedDepositPlayerId,
      fixture.approvedReferencePlayerId,
      fixture.approvedReferenceRetryPlayerId,
      fixture.approvedReferenceSecondRetryPlayerId,
      fixture.concurrentApprovalPlayerId,
      fixture.oppositeReviewPlayerId,
      ...fixture.racePlayerIds,
    ];
    await pool.query("DELETE FROM daily007_v2_notifications WHERE user_id = ANY($1::uuid[])", [playerIds]);
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])", [playerIds]);
    await pool.query("DELETE FROM daily007_v2_payments WHERE user_id = ANY($1::uuid[])", [playerIds]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
      [...playerIds, fixture.adminId, fixture.secondAdminId],
    ]);
  } finally {
    if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
    await pool.end();
  }
});

before(async () => {
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins)
     VALUES
       ($1, 'UPI Reference Test Player', $4, 'test-salt', 'test-hash', 'user', 700),
       ($17, 'Payer UPI Validation Player', $18, 'test-salt', 'test-hash', 'user', 250),
       ($2, 'UPI Reference Retry Player', $5, 'test-salt', 'test-hash', 'user', 350),
       ($3, 'UPI Reference Test Admin', $6, 'test-salt', 'test-hash', 'admin', 0),
       ($7, 'UPI Reference Race Player One', $8, 'test-salt', 'test-hash', 'user', 900),
       ($9, 'UPI Reference Race Player Two', $10, 'test-salt', 'test-hash', 'user', 450),
       ($11, 'UPI Reference Protected Deposit Player', $12, 'test-salt', 'test-hash', 'user', 500),
       ($13, 'UPI Reference Second Admin', $14, 'test-salt', 'test-hash', 'admin', 0),
       ($15, 'UPI Reference Concurrent Approval Player', $16, 'test-salt', 'test-hash', 'user', 1100),
       ($19, 'Approved Reference Player', $20, 'test-salt', 'test-hash', 'user', 500),
       ($21, 'Approved Reference Retry Player', $22, 'test-salt', 'test-hash', 'user', 350),
        ($23, 'Approved Reference Second Retry Player', $24, 'test-salt', 'test-hash', 'user', 275),
        ($25, 'Opposite Review Race Player', $26, 'test-salt', 'test-hash', 'user', 620)`,
    [
      fixture.playerId,
      fixture.retryPlayerId,
      fixture.adminId,
      `wallet-reference-player-${fixture.playerId}@example.test`,
      `wallet-reference-retry-${fixture.retryPlayerId}@example.test`,
      `wallet-reference-admin-${fixture.adminId}@example.test`,
      fixture.racePlayerIds[0],
      `wallet-reference-race-${fixture.racePlayerIds[0]}@example.test`,
      fixture.racePlayerIds[1],
      `wallet-reference-race-${fixture.racePlayerIds[1]}@example.test`,
      fixture.protectedDepositPlayerId,
      `wallet-reference-protected-deposit-${fixture.protectedDepositPlayerId}@example.test`,
      fixture.secondAdminId,
      `wallet-reference-admin-${fixture.secondAdminId}@example.test`,
      fixture.concurrentApprovalPlayerId,
      `wallet-reference-approval-race-${fixture.concurrentApprovalPlayerId}@example.test`,
      fixture.payerUpiValidationPlayerId,
      `payer-upi-validation-${fixture.payerUpiValidationPlayerId}@example.test`,
      fixture.approvedReferencePlayerId,
      `approved-reference-${fixture.approvedReferencePlayerId}@example.test`,
      fixture.approvedReferenceRetryPlayerId,
      `approved-reference-retry-${fixture.approvedReferenceRetryPlayerId}@example.test`,
      fixture.approvedReferenceSecondRetryPlayerId,
      `approved-reference-second-retry-${fixture.approvedReferenceSecondRetryPlayerId}@example.test`,
      fixture.oppositeReviewPlayerId,
      `opposite-review-race-${fixture.oppositeReviewPlayerId}@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO daily007_v2_settings (id, settings)
     VALUES (1, $1::jsonb)`,
    [JSON.stringify({
      rechargeEnabled: "true",
      upiId: "daily007@upi",
      upiQrObjectPath: "test-only-qr",
      minPurchase: "1",
      maxPurchase: "5000",
      coinToMoneyRate: "2.5",
    })],
  );
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({
      error: error instanceof Error ? error.message : String(error),
    });
  });

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
  method: "GET" | "POST" | "DELETE",
  body?: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const token = makeToken(actorId, 0);
  assert.ok(token, "The isolated account should receive a Daily007 session token.");
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

async function backendPid(client: Awaited<ReturnType<typeof pool.connect>>): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = result.rows[0]?.pid;
  assert.ok(pid, "PostgreSQL must provide a backend id for the reference blocker.");
  return Number(pid);
}

async function waitForBlockedPaymentRequests(blockerPid: number, expectedCount: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.datname = current_database()
          AND activity.wait_event_type = 'Lock'
          AND activity.query ILIKE $1
        ORDER BY activity.query_start`,
      ["%INSERT INTO daily007_v2_payments%"],
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(result.rows.length, expectedCount, "Only the two duplicate-reference requests should be waiting.");
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.map(Number).includes(blockerPid)),
        "At least one deposit request must be waiting directly on the reference blocker.",
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => Number(pid) === blockerPid || requestPids.has(Number(pid))),
        ),
        "Each deposit request must be queued behind the blocker or the earlier waiting request.",
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} duplicate-reference requests to block in PostgreSQL.`);
}

async function waitForBlockedPaymentReviewRequests(blockerPid: number, expectedCount: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.datname = current_database()
          AND activity.wait_event_type = 'Lock'
          AND activity.query ILIKE $1
        ORDER BY activity.query_start`,
      ["%FROM daily007_v2_payments WHERE id =%"],
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(result.rows.length, expectedCount, "Only the expected payment reviews should be waiting.");
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.map(Number).includes(blockerPid)),
        "At least one review must be waiting directly on the test payment-row lock.",
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => Number(pid) === blockerPid || requestPids.has(Number(pid))),
        ),
        "Each review must be queued behind the blocker or the earlier waiting review.",
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} payment reviews to block in PostgreSQL.`);
}

test("payment requests require a valid payer UPI ID and save valid values", async () => {
  const initialPayments = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM daily007_v2_payments WHERE user_id = $1",
    [fixture.payerUpiValidationPlayerId],
  );
  assert.equal(initialPayments.rows[0]?.count, "0");

  await withServer(async (origin) => {
    const baseRequest = { coins: 100, txnId: "payer-upi-validation-reference" };
    const missing = await call(origin, fixture.payerUpiValidationPlayerId, "/payments", "POST", baseRequest);
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, "payerUpiId must contain 1–200 characters.");

    const blank = await call(origin, fixture.payerUpiValidationPlayerId, "/payments", "POST", {
      ...baseRequest,
      payerUpiId: "   ",
    });
    assert.equal(blank.status, 400);
    assert.equal(blank.body.error, "payerUpiId must contain 1–200 characters.");

    const invalidPayerUpiIds = [
      "payerupi",
      "@upi",
      "p@upi",
      "payer@",
      "payer@@upi",
      "payer name@upi",
      "payer@upi!",
      `${"a".repeat(101)}@upi`,
    ];
    for (const payerUpiId of invalidPayerUpiIds) {
      const invalid = await call(origin, fixture.payerUpiValidationPlayerId, "/payments", "POST", {
        ...baseRequest,
        payerUpiId,
      });
      assert.equal(invalid.status, 400, `${payerUpiId} should be rejected.`);
      assert.equal(
        invalid.body.error,
        "Use 2–100 letters, numbers, dots, underscores, or hyphens before @ and 2–100 letters, numbers, dots, or hyphens after it (for example, name@upi).",
      );
    }

    const afterRejections = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM daily007_v2_payments WHERE user_id = $1",
      [fixture.payerUpiValidationPlayerId],
    );
    assert.equal(afterRejections.rows[0]?.count, "0");

    const valid = await call(origin, fixture.payerUpiValidationPlayerId, "/payments", "POST", {
      ...baseRequest,
      payerUpiId: "pay.user_1-2@upi-bank",
    });
    assert.equal(valid.status, 201);
    assert.equal(valid.body.payerUpiId, "pay.user_1-2@upi-bank");

    const savedPayments = await pool.query<{ payer_upi_id: string | null }>(
      "SELECT payer_upi_id FROM daily007_v2_payments WHERE user_id = $1",
      [fixture.payerUpiValidationPlayerId],
    );
    assert.deepEqual(savedPayments.rows, [{ payer_upi_id: "pay.user_1-2@upi-bank" }]);
  });
});

test("a rejected deposit keeps its normalized UPI reference unique in PostgreSQL", async () => {
  const initialAccount = await pool.query<{ wallet_coins: number }>(
    "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
    [[fixture.playerId, fixture.retryPlayerId]],
  );
  const initialLedger = await pool.query(
    `SELECT id, user_id, amount, balance_after, reason
       FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])`,
    [[fixture.playerId, fixture.retryPlayerId]],
  );
  assert.deepEqual(
    initialAccount.rows.map((row) => row.wallet_coins).sort((a, b) => a - b),
    [350, 700],
  );
  assert.deepEqual(initialLedger.rows, []);

  await withServer(async (origin) => {
    const deposit = await call(origin, fixture.playerId, "/payments", "POST", {
      coins: 120,
      payerUpiId: "player@upi",
      txnId: "upi-ref-unique-1",
    });
    assert.equal(deposit.status, 201);
    const paymentId = deposit.body.id as string;
    assert.ok(paymentId);

    const rejection = await call(
      origin,
      fixture.adminId,
      `/admin/payments/${paymentId}/reject`,
      "POST",
      { reason: "The transfer could not be verified." },
    );
    assert.equal(rejection.status, 200);

    const normalizedRetry = await call(origin, fixture.retryPlayerId, "/payments", "POST", {
      coins: 120,
      payerUpiId: "player@upi",
      txnId: "  ＵＰＩ-ＲＥＦ-ＵＮＩＱＵＥ-１  ",
    });
    assert.equal(normalizedRetry.status, 409);
    assert.equal(normalizedRetry.body.error, "This payment reference has already been submitted.");

    const payments = await pool.query<{
      id: string;
      status: string;
      reference: string;
      reference_normalized: string;
    }>(
      `SELECT id, status, reference, reference_normalized
         FROM daily007_v2_payments
        WHERE reference_normalized = $1`,
      ["UPI-REF-UNIQUE-1"],
    );
    assert.deepEqual(payments.rows, [{
      id: paymentId,
      status: "rejected",
      reference: "upi-ref-unique-1",
      reference_normalized: "UPI-REF-UNIQUE-1",
    }]);

    const finalAccount = await pool.query<{ wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[fixture.playerId, fixture.retryPlayerId]],
    );
    const finalLedger = await pool.query(
      `SELECT id, user_id, amount, balance_after, reason
         FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])`,
      [[fixture.playerId, fixture.retryPlayerId]],
    );
    assert.deepEqual(finalAccount.rows, initialAccount.rows);
    assert.deepEqual(finalLedger.rows, initialLedger.rows);
  });
});

test("an approved deposit keeps its case- and Unicode-normalized UPI reference globally unique", async () => {
  const originalReference = `  ＡＰＰＲＯＶＥＤ-ＵＰＩ-${randomUUID().replace(/-/g, "").toUpperCase()}  `;
  const storedReference = originalReference.trim();
  const normalizedReference = originalReference.normalize("NFKC").trim().toLocaleUpperCase("en-US");
  const retryReference = normalizedReference.toLocaleLowerCase("en-US");
  const originalPlayerId = fixture.approvedReferencePlayerId;
  const retryPlayerId = fixture.approvedReferenceRetryPlayerId;
  const secondRetryPlayerId = fixture.approvedReferenceSecondRetryPlayerId;
  const retryPlayerIds = [retryPlayerId, secondRetryPlayerId];
  const coins = 125;
  const initialAccounts = await pool.query<{ id: string; wallet_coins: number }>(
    `SELECT id, wallet_coins
       FROM daily007_v2_users
      WHERE id = ANY($1::uuid[])
      ORDER BY id`,
    [[originalPlayerId, ...retryPlayerIds]],
  );
  const initialRetryLedger = await pool.query(
    `SELECT id, user_id, amount, balance_after, reason
       FROM daily007_v2_wallet_ledger
      WHERE user_id = ANY($1::uuid[])
      ORDER BY user_id, created_at, id`,
    [retryPlayerIds],
  );
  const originalStartingBalance = initialAccounts.rows.find(
    (account) => account.id === originalPlayerId,
  )?.wallet_coins;
  const retryStartingBalance = initialAccounts.rows.find(
    (account) => account.id === retryPlayerId,
  )?.wallet_coins;
  const secondRetryStartingBalance = initialAccounts.rows.find(
    (account) => account.id === secondRetryPlayerId,
  )?.wallet_coins;
  assert.equal(originalStartingBalance, 500);
  assert.equal(retryStartingBalance, 350);
  assert.equal(secondRetryStartingBalance, 275);
  assert.deepEqual(initialRetryLedger.rows, []);

  await pool.query(
    `INSERT INTO daily007_v2_notifications (user_id, title, body, type, read_at)
     VALUES ($1, 'Existing payment update', 'This retry account already has a notification.', 'payment', $2)`,
    [retryPlayerId, new Date("2026-01-01T00:00:00.000Z")],
  );

  await withServer(async (origin) => {
    const deposit = await call(origin, originalPlayerId, "/payments", "POST", {
      coins,
      payerUpiId: "approved-player@upi",
      txnId: originalReference,
    });
    assert.equal(deposit.status, 201);
    const paymentId = deposit.body.id as string;
    assert.ok(paymentId);

    const approval = await call(
      origin,
      fixture.adminId,
      `/admin/payments/${paymentId}/approve`,
      "POST",
    );
    assert.equal(approval.status, 200);
    assert.equal(approval.body.status, "approved");

    const initialRetryNotifications = await pool.query<{
      id: string;
      title: string;
      body: string;
      type: string;
      read_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, title, body, type, read_at, created_at
         FROM daily007_v2_notifications
        WHERE user_id = $1
        ORDER BY created_at, id`,
      [retryPlayerId],
    );
    assert.equal(initialRetryNotifications.rows.length, 1);

    const approvedState = await pool.query<{
      id: string;
      user_id: string;
      status: string;
      reference: string;
      reference_normalized: string;
    }>(
      `SELECT id, user_id, status, reference, reference_normalized
         FROM daily007_v2_payments
        WHERE reference_normalized = $1`,
      [normalizedReference],
    );
    assert.deepEqual(approvedState.rows, [{
      id: paymentId,
      user_id: originalPlayerId,
      status: "approved",
      reference: storedReference,
      reference_normalized: normalizedReference,
    }]);

    let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
    let blockerTransactionOpen = false;
    let retries: Promise<{ status: number; body: any }>[] = [];
    try {
      await pool.query(
        `CREATE OR REPLACE FUNCTION daily007_test_pause_approved_reference_retries()
         RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           PERFORM pg_advisory_xact_lock(743181, 1);
           RETURN NEW;
         END;
         $$`,
      );
      await pool.query(
        `CREATE TRIGGER daily007_test_pause_approved_reference_retries
         BEFORE INSERT ON daily007_v2_payments
         FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_approved_reference_retries()`,
      );

      blocker = await pool.connect();
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      const blockerBackendPid = await backendPid(blocker);
      await blocker.query("SELECT pg_advisory_xact_lock(743181, 1)");

      retries = [
        call(origin, retryPlayerId, "/payments", "POST", {
          coins,
          payerUpiId: "retry-player@upi",
          txnId: retryReference,
        }),
        call(origin, secondRetryPlayerId, "/payments", "POST", {
          coins,
          payerUpiId: "second-retry-player@upi",
          txnId: originalReference,
        }),
      ];
      await waitForBlockedPaymentRequests(blockerBackendPid, 2);
      await blocker.query("COMMIT");
      blockerTransactionOpen = false;

      const retryResponses = await Promise.all(retries);
      assert.deepEqual(
        retryResponses.map((response) => response.status),
        [409, 409],
      );
      assert.ok(retryResponses.every(
        (response) => response.body.error === "This payment reference has already been submitted.",
      ));
    } finally {
      if (blockerTransactionOpen && blocker) {
        await blocker.query("ROLLBACK");
        blockerTransactionOpen = false;
      }
      await Promise.allSettled(retries);
      blocker?.release();
      await pool.query(
        "DROP TRIGGER IF EXISTS daily007_test_pause_approved_reference_retries ON daily007_v2_payments",
      );
      await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_approved_reference_retries()");
    }

    const finalPayments = await pool.query<{
      id: string;
      user_id: string;
      status: string;
      reference: string;
      reference_normalized: string;
    }>(
      `SELECT id, user_id, status, reference, reference_normalized
         FROM daily007_v2_payments
        WHERE reference_normalized = $1`,
      [normalizedReference],
    );
    assert.deepEqual(
      finalPayments.rows,
      approvedState.rows,
      "A cross-account retry must leave the one approved payment unchanged.",
    );

    const finalAccounts = await pool.query<{ id: string; wallet_coins: number }>(
      `SELECT id, wallet_coins
         FROM daily007_v2_users
        WHERE id = ANY($1::uuid[])
        ORDER BY id`,
      [[originalPlayerId, ...retryPlayerIds]],
    );
    const finalOriginalBalance = finalAccounts.rows.find(
      (account) => account.id === originalPlayerId,
    )?.wallet_coins;
    const finalRetryBalance = finalAccounts.rows.find(
      (account) => account.id === retryPlayerId,
    )?.wallet_coins;
    const finalSecondRetryBalance = finalAccounts.rows.find(
      (account) => account.id === secondRetryPlayerId,
    )?.wallet_coins;
    assert.equal(finalOriginalBalance, originalStartingBalance! + coins);
    assert.equal(finalRetryBalance, retryStartingBalance);
    assert.equal(finalSecondRetryBalance, secondRetryStartingBalance);

    const finalRetryLedger = await pool.query(
      `SELECT id, user_id, amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE user_id = ANY($1::uuid[])
        ORDER BY user_id, created_at, id`,
      [retryPlayerIds],
    );
    assert.deepEqual(
      finalRetryLedger.rows,
      initialRetryLedger.rows,
      "Concurrent duplicate retries must not change either retry player's ledger.",
    );
    const originalApprovalLedger = await pool.query<{
      amount: number;
      balance_after: number;
      reason: string;
    }>(
      `SELECT amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND reason = 'payment_approved'
        ORDER BY created_at, id`,
      [originalPlayerId],
    );
    assert.deepEqual(originalApprovalLedger.rows, [{
      amount: coins,
      balance_after: originalStartingBalance! + coins,
      reason: "payment_approved",
    }]);

    const finalRetryNotifications = await pool.query(
      `SELECT id, title, body, type, read_at, created_at
         FROM daily007_v2_notifications
        WHERE user_id = $1
        ORDER BY created_at, id`,
      [retryPlayerId],
    );
    assert.deepEqual(
      finalRetryNotifications.rows,
      initialRetryNotifications.rows,
      "Retrying an already-approved reference must leave the retry account's notifications unchanged.",
    );
  });
});

test("a deleted deposit keeps its normalized UPI reference reserved", async () => {
  const referenceSuffix = randomUUID().replace(/-/g, "").toUpperCase();
  const originalReference = `  ＵＰＩ-ＲＥＦ-ＤＥＬＥＴＥＤ-${referenceSuffix}  `;
  const storedReference = originalReference.trim();
  const normalizedReference = `UPI-REF-DELETED-${referenceSuffix}`;
  const duplicateReference = `upi-ref-deleted-${referenceSuffix.toLowerCase()}`;
  const newReference = `  NEW-UPI-REF-${referenceSuffix.toLowerCase()}  `;
  const storedNewReference = newReference.trim();
  const normalizedNewReference = `NEW-UPI-REF-${referenceSuffix}`;
  const affectedUserIds = [fixture.playerId, fixture.retryPlayerId];
  const initialAccounts = await pool.query<{ id: string; wallet_coins: number }>(
    `SELECT id, wallet_coins FROM daily007_v2_users
      WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [affectedUserIds],
  );
  const initialLedger = await pool.query(
    `SELECT id, user_id, amount, balance_after, reason
       FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])`,
    [affectedUserIds],
  );

  await withServer(async (origin) => {
    const deposit = await call(origin, fixture.playerId, "/payments", "POST", {
      coins: 80,
      payerUpiId: "player@upi",
      txnId: originalReference,
    });
    assert.equal(deposit.status, 201);
    const paymentId = deposit.body.id as string;
    assert.ok(paymentId);

    const originalPaymentResult = await pool.query<{
      id: string;
      user_id: string;
      coins: number;
      amount: number;
      payer_upi_id: string | null;
      reference: string;
      reference_normalized: string;
      proof_object_path: string | null;
      status: string;
      review_reason: string | null;
      reviewed_by: string | null;
      created_at: Date;
      reviewed_at: Date | null;
    }>(
      `SELECT id, user_id, coins, amount, payer_upi_id, reference, reference_normalized,
              proof_object_path, status, review_reason, reviewed_by, created_at, reviewed_at
         FROM daily007_v2_payments
        WHERE id = $1`,
      [paymentId],
    );
    assert.equal(originalPaymentResult.rows.length, 1);
    const originalPayment = originalPaymentResult.rows[0]!;
    assert.equal(originalPayment.status, "pending");

    const deletion = await call(
      origin,
      fixture.adminId,
      `/admin/payments/${paymentId}`,
      "DELETE",
    );
    assert.equal(deletion.status, 200);
    assert.equal(deletion.body.id, paymentId);
    assert.equal(deletion.body.deleted, true);

    const newDeposit = await call(origin, fixture.playerId, "/payments", "POST", {
      coins: 80,
      payerUpiId: "player@upi",
      txnId: newReference,
    });
    assert.equal(newDeposit.status, 201);
    assert.equal(newDeposit.body.status, "pending");
    assert.equal(newDeposit.body.txnId, storedNewReference);
    const newPaymentId = newDeposit.body.id as string;
    assert.ok(newPaymentId);
    assert.notEqual(newPaymentId, paymentId);

    const duplicate = await call(origin, fixture.retryPlayerId, "/payments", "POST", {
      coins: 80,
      payerUpiId: "different-player@upi",
      txnId: duplicateReference,
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, "This payment reference has already been submitted.");

    const payments = await pool.query<{
      id: string;
      user_id: string;
      status: string;
      reference: string;
      reference_normalized: string;
    }>(
      `SELECT id, user_id, status, reference, reference_normalized
         FROM daily007_v2_payments
        WHERE reference_normalized = ANY($1::text[])
        ORDER BY reference_normalized`,
      [[normalizedReference, normalizedNewReference]],
    );
    assert.deepEqual(payments.rows, [
      {
        id: newPaymentId,
        user_id: fixture.playerId,
        status: "pending",
        reference: storedNewReference,
        reference_normalized: normalizedNewReference,
      },
      {
        id: paymentId,
        user_id: fixture.playerId,
        status: "deleted",
        reference: storedReference,
        reference_normalized: normalizedReference,
      },
    ]);

    const originalPaymentAfterDelete = await pool.query(
      `SELECT id, user_id, coins, amount, payer_upi_id, reference, reference_normalized,
              proof_object_path, status, review_reason, reviewed_by, created_at, reviewed_at
         FROM daily007_v2_payments
        WHERE id = $1`,
      [paymentId],
    );
    assert.deepEqual(originalPaymentAfterDelete.rows, [{
      ...originalPayment,
      status: "deleted",
    }]);

    const finalAccounts = await pool.query<{ id: string; wallet_coins: number }>(
      `SELECT id, wallet_coins FROM daily007_v2_users
        WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [affectedUserIds],
    );
    const finalLedger = await pool.query(
      `SELECT id, user_id, amount, balance_after, reason
         FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])`,
      [affectedUserIds],
    );
    assert.deepEqual(finalAccounts.rows, initialAccounts.rows);
    assert.deepEqual(finalLedger.rows, initialLedger.rows);
  });
});

test("an approved deposit cannot be deleted and keeps its wallet history intact", async () => {
  const reference = `APPROVED-UPI-REF-${randomUUID().replace(/-/g, "").toUpperCase()}`;

  await withServer(async (origin) => {
    const deposit = await call(origin, fixture.protectedDepositPlayerId, "/payments", "POST", {
      coins: 125,
      payerUpiId: "protected-player@upi",
      txnId: reference,
    });
    assert.equal(deposit.status, 201);
    const paymentId = deposit.body.id as string;
    assert.ok(paymentId);

    const approval = await call(
      origin,
      fixture.adminId,
      `/admin/payments/${paymentId}/approve`,
      "POST",
    );
    assert.equal(approval.status, 200);
    assert.equal(approval.body.status, "approved");

    const approvedState = await pool.query(
      `SELECT p.id, p.user_id, p.coins, p.status, p.reference,
              u.wallet_coins,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'id', ledger.id,
                    'amount', ledger.amount,
                    'balanceAfter', ledger.balance_after,
                    'reason', ledger.reason
                  ) ORDER BY ledger.created_at, ledger.id
                ) FILTER (WHERE ledger.id IS NOT NULL),
                '[]'::jsonb
              ) AS ledger
         FROM daily007_v2_payments p
         JOIN daily007_v2_users u ON u.id = p.user_id
         LEFT JOIN daily007_v2_wallet_ledger ledger ON ledger.user_id = u.id
        WHERE p.id = $1
        GROUP BY p.id, u.wallet_coins`,
      [paymentId],
    );
    assert.equal(approvedState.rows.length, 1);
    const approvedSnapshot = approvedState.rows[0] as {
      id: string;
      user_id: string;
      coins: number;
      status: string;
      reference: string;
      wallet_coins: number;
      ledger: Array<{ id: string; amount: number; balanceAfter: number; reason: string }>;
    };
    assert.equal(approvedSnapshot.id, paymentId);
    assert.equal(approvedSnapshot.user_id, fixture.protectedDepositPlayerId);
    assert.equal(approvedSnapshot.coins, 125);
    assert.equal(approvedSnapshot.status, "approved");
    assert.equal(approvedSnapshot.reference, reference);
    assert.equal(approvedSnapshot.wallet_coins, 625);
    assert.equal(approvedSnapshot.ledger.length, 1);
    assert.ok(approvedSnapshot.ledger[0]?.id);
    assert.deepEqual(
      (({ id: _id, ...entry }) => entry)(approvedSnapshot.ledger[0]!),
      { amount: 125, balanceAfter: 625, reason: "payment_approved" },
    );

    const deletion = await call(
      origin,
      fixture.adminId,
      `/admin/payments/${paymentId}`,
      "DELETE",
    );
    assert.equal(deletion.status, 409);
    assert.equal(deletion.body.error, "Approved financial records cannot be deleted.");

    const finalState = await pool.query(
      `SELECT p.id, p.user_id, p.coins, p.status, p.reference,
              u.wallet_coins,
              COALESCE(
                jsonb_agg(
                  jsonb_build_object(
                    'id', ledger.id,
                    'amount', ledger.amount,
                    'balanceAfter', ledger.balance_after,
                    'reason', ledger.reason
                  ) ORDER BY ledger.created_at, ledger.id
                ) FILTER (WHERE ledger.id IS NOT NULL),
                '[]'::jsonb
              ) AS ledger
         FROM daily007_v2_payments p
         JOIN daily007_v2_users u ON u.id = p.user_id
         LEFT JOIN daily007_v2_wallet_ledger ledger ON ledger.user_id = u.id
        WHERE p.id = $1
        GROUP BY p.id, u.wallet_coins`,
      [paymentId],
    );
    assert.deepEqual(finalState.rows, approvedState.rows);

    const history = await call(origin, fixture.adminId, "/admin/payments", "GET");
    assert.equal(history.status, 200);
    assert.ok(history.body.some((payment: { id: string; status: string }) =>
      payment.id === paymentId && payment.status === "approved",
    ));
  });
});

test("concurrent admin approvals credit a deposit and notify its player exactly once", async () => {
  const playerId = fixture.concurrentApprovalPlayerId;
  const coins = 140;
  const reference = `APPROVAL-RACE-${randomUUID().replace(/-/g, "").toUpperCase()}`;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let approvals: Promise<{ status: number; body: any }>[] = [];
  const before = await pool.query<{ wallet_coins: number }>(
    "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
    [playerId],
  );
  assert.equal(before.rows.length, 1);
  const initialBalance = before.rows[0]!.wallet_coins;

  try {
    await withServer(async (origin) => {
      const deposit = await call(origin, playerId, "/payments", "POST", {
        coins,
        payerUpiId: "approval-race-player@upi",
        txnId: reference,
      });
      assert.equal(deposit.status, 201);
      const paymentId = deposit.body.id as string;
      assert.ok(paymentId);

      blocker = await pool.connect();
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_payments WHERE id = $1 FOR UPDATE",
        [paymentId],
      );
      const blockerBackendPid = await backendPid(blocker);

      approvals = [
        call(origin, fixture.adminId, `/admin/payments/${paymentId}/approve`, "POST"),
        call(origin, fixture.secondAdminId, `/admin/payments/${paymentId}/approve`, "POST"),
      ];
      try {
        await waitForBlockedPaymentReviewRequests(blockerBackendPid, 2);
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const responses = await Promise.all(approvals);
      assert.deepEqual(responses.map((response) => response.status), [200, 200]);
      assert.ok(responses.every((response) => response.body.status === "approved"));

      const payment = await pool.query<{
        id: string;
        user_id: string;
        coins: number;
        status: string;
        reviewed_by: string;
      }>(
        `SELECT id, user_id, coins, status, reviewed_by
           FROM daily007_v2_payments WHERE id = $1`,
        [paymentId],
      );
      assert.deepEqual(payment.rows, [{
        id: paymentId,
        user_id: playerId,
        coins,
        status: "approved",
        reviewed_by: responses[0]!.body.reviewed_by ?? responses[0]!.body.reviewedBy ??
          responses[1]!.body.reviewed_by ?? responses[1]!.body.reviewedBy,
      }]);
      assert.ok(
        [fixture.adminId, fixture.secondAdminId].includes(payment.rows[0]!.reviewed_by),
        "The approved payment must record one of the two reviewing admins.",
      );

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [playerId],
      );
      assert.deepEqual(wallet.rows, [{ wallet_coins: initialBalance + coins }]);

      const ledger = await pool.query<{
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1 AND reason = 'payment_approved'`,
        [playerId],
      );
      assert.deepEqual(ledger.rows, [{
        amount: coins,
        balance_after: initialBalance + coins,
        reason: "payment_approved",
      }]);

      const notifications = await pool.query<{ title: string; body: string; type: string }>(
        `SELECT title, body, type
           FROM daily007_v2_notifications
          WHERE user_id = $1 AND title = 'Coin deposit approved'`,
        [playerId],
      );
      assert.deepEqual(notifications.rows, [{
        title: "Coin deposit approved",
        body: `Your coin deposit has been approved. ${coins} coins have been added to your wallet.`,
        type: "payment",
      }]);
    });
  } finally {
    if (blockerTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      blockerTransactionOpen = false;
    }
    await Promise.allSettled(approvals);
    blocker?.release();
  }
});

test("concurrent approval and rejection allow one outcome and only its effects", async () => {
  const playerId = fixture.oppositeReviewPlayerId;
  const coins = 175;
  const reason = "The transfer could not be verified.";
  const reference = `OPPOSITE-REVIEW-RACE-${randomUUID().replace(/-/g, "").toUpperCase()}`;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let reviews: Promise<{ status: number; body: any }>[] = [];
  const before = await pool.query<{ wallet_coins: number }>(
    "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
    [playerId],
  );
  assert.equal(before.rows.length, 1);
  const initialBalance = before.rows[0]!.wallet_coins;

  try {
    await withServer(async (origin) => {
      const deposit = await call(origin, playerId, "/payments", "POST", {
        coins,
        payerUpiId: "opposite-review-player@upi",
        txnId: reference,
      });
      assert.equal(deposit.status, 201);
      const paymentId = deposit.body.id as string;
      assert.ok(paymentId);

      blocker = await pool.connect();
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_payments WHERE id = $1 FOR UPDATE",
        [paymentId],
      );
      const blockerBackendPid = await backendPid(blocker);

      reviews = [
        call(origin, fixture.adminId, `/admin/payments/${paymentId}/approve`, "POST"),
        call(origin, fixture.secondAdminId, `/admin/payments/${paymentId}/reject`, "POST", { reason }),
      ];
      try {
        await waitForBlockedPaymentReviewRequests(blockerBackendPid, 2);
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const responses = await Promise.all(reviews);
      assert.equal(responses.filter((response) => response.status === 200).length, 1);
      assert.equal(responses.filter((response) => response.status === 409).length, 1);
      const winner = responses.find((response) => response.status === 200)!;
      const loser = responses.find((response) => response.status === 409)!;
      assert.equal(loser.body.error, "This request has already been reviewed with a different outcome.");
      assert.ok(winner.body.status === "approved" || winner.body.status === "rejected");

      const finalStatus = winner.body.status as "approved" | "rejected";
      const payment = await pool.query<{
        id: string;
        user_id: string;
        coins: number;
        status: string;
        reviewed_by: string;
        review_reason: string | null;
      }>(
        `SELECT id, user_id, coins, status, reviewed_by, review_reason
           FROM daily007_v2_payments WHERE id = $1`,
        [paymentId],
      );
      assert.equal(payment.rows.length, 1);
      assert.deepEqual(
        (({ reviewed_by: _reviewedBy, ...row }) => row)(payment.rows[0]!),
        {
          id: paymentId,
          user_id: playerId,
          coins,
          status: finalStatus,
          review_reason: finalStatus === "rejected" ? reason : null,
        },
      );
      assert.ok(
        [fixture.adminId, fixture.secondAdminId].includes(payment.rows[0]!.reviewed_by),
        "The final payment must record one of the two reviewing admins.",
      );

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [playerId],
      );
      const ledger = await pool.query<{
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT amount, balance_after, reason
           FROM daily007_v2_wallet_ledger WHERE user_id = $1`,
        [playerId],
      );
      const notifications = await pool.query<{ title: string; body: string; type: string }>(
        `SELECT title, body, type
           FROM daily007_v2_notifications WHERE user_id = $1`,
        [playerId],
      );

      if (finalStatus === "approved") {
        assert.deepEqual(wallet.rows, [{ wallet_coins: initialBalance + coins }]);
        assert.deepEqual(ledger.rows, [{
          amount: coins,
          balance_after: initialBalance + coins,
          reason: "payment_approved",
        }]);
        assert.deepEqual(notifications.rows, [{
          title: "Coin deposit approved",
          body: `Your coin deposit has been approved. ${coins} coins have been added to your wallet.`,
          type: "payment",
        }]);
      } else {
        assert.deepEqual(wallet.rows, [{ wallet_coins: initialBalance }]);
        assert.deepEqual(ledger.rows, []);
        assert.deepEqual(notifications.rows, [{
          title: "Coin deposit rejected",
          body: `Your coin deposit request was rejected. Reason: ${reason}`,
          type: "payment",
        }]);
      }
    });
  } finally {
    if (blockerTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      blockerTransactionOpen = false;
    }
    await Promise.allSettled(reviews);
    blocker?.release();
  }
});

test("concurrent deposits from different accounts reject the same normalized UPI reference", async () => {
  const referenceSuffix = randomUUID().toUpperCase();
  const normalizedReference = `RACE-UPI-REF-${referenceSuffix}`;
  const submittedReferences = [
    `  ＲＡＣＥ-ＵＰＩ-ＲＥＦ-${referenceSuffix}  `,
    `race-upi-ref-${referenceSuffix.toLowerCase()}`,
  ];
  const initialAccounts = await pool.query<{ id: string; wallet_coins: number }>(
    `SELECT id, wallet_coins FROM daily007_v2_users
      WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [fixture.racePlayerIds],
  );
  const initialLedger = await pool.query(
    `SELECT id, user_id, amount, balance_after, reason
       FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])`,
    [fixture.racePlayerIds],
  );
  assert.deepEqual(
    initialAccounts.rows.map((row) => row.wallet_coins).sort((a, b) => a - b),
    [450, 900],
  );
  assert.deepEqual(initialLedger.rows, []);

  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let submissions: Promise<{ status: number; body: any }>[] = [];
  try {
    await withServer(async (origin) => {
      blocker = await pool.connect();
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        `INSERT INTO daily007_v2_payments
           (user_id, coins, amount, reference, reference_normalized)
         VALUES ($1, 50, 125, $2, $3)`,
        [fixture.adminId, normalizedReference, normalizedReference],
      );
      const blockerBackendPid = await backendPid(blocker);

      submissions = fixture.racePlayerIds.map((playerId, index) =>
        call(origin, playerId, "/payments", "POST", {
          coins: index === 0 ? 120 : 180,
          payerUpiId: `race-player-${index + 1}@upi`,
          txnId: submittedReferences[index],
        }),
      );
      try {
        await waitForBlockedPaymentRequests(blockerBackendPid, 2);
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const responses = await Promise.all(submissions);
      assert.deepEqual(
        responses.map((response) => response.status).sort((a, b) => a - b),
        [201, 409],
      );
      const winnerIndex = responses.findIndex((response) => response.status === 201);
      const winner = responses[winnerIndex];
      const duplicate = responses[1 - winnerIndex];
      assert.ok(winner);
      assert.ok(duplicate);
      assert.ok(winnerIndex === 0 || winnerIndex === 1);
      assert.equal(winner.body.status, "pending");
      assert.equal(winner.body.txnId, submittedReferences[winnerIndex].trim());
      assert.equal(duplicate.body.error, "This payment reference has already been submitted.");

      const payments = await pool.query<{
        id: string;
        user_id: string;
        coins: number;
        status: string;
        reference: string;
        reference_normalized: string;
      }>(
        `SELECT id, user_id, coins, status, reference, reference_normalized
           FROM daily007_v2_payments
          WHERE reference_normalized = $1`,
        [normalizedReference],
      );
      assert.deepEqual(payments.rows, [{
        id: winner.body.id,
        user_id: fixture.racePlayerIds[winnerIndex],
        coins: winnerIndex === 0 ? 120 : 180,
        status: "pending",
        reference: submittedReferences[winnerIndex].trim(),
        reference_normalized: normalizedReference,
      }]);

      const finalAccounts = await pool.query<{ id: string; wallet_coins: number }>(
        `SELECT id, wallet_coins FROM daily007_v2_users
          WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [fixture.racePlayerIds],
      );
      const finalLedger = await pool.query(
        `SELECT id, user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])`,
        [fixture.racePlayerIds],
      );
      assert.deepEqual(finalAccounts.rows, initialAccounts.rows);
      assert.deepEqual(finalLedger.rows, initialLedger.rows);
    });
  } finally {
    if (blockerTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      blockerTransactionOpen = false;
    }
    await Promise.allSettled(submissions);
    blocker?.release();
  }
});
