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
  retryPlayerId: randomUUID(),
  protectedDepositPlayerId: randomUUID(),
  racePlayerIds: [randomUUID(), randomUUID()] as const,
  adminId: randomUUID(),
};

after(async () => {
  try {
    const playerIds = [
      fixture.playerId,
      fixture.retryPlayerId,
      fixture.protectedDepositPlayerId,
      ...fixture.racePlayerIds,
    ];
    await pool.query("DELETE FROM daily007_v2_notifications WHERE user_id = ANY($1::uuid[])", [playerIds]);
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])", [playerIds]);
    await pool.query("DELETE FROM daily007_v2_payments WHERE user_id = ANY($1::uuid[])", [playerIds]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [
      [...playerIds, fixture.adminId],
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
       ($2, 'UPI Reference Retry Player', $5, 'test-salt', 'test-hash', 'user', 350),
       ($3, 'UPI Reference Test Admin', $6, 'test-salt', 'test-hash', 'admin', 0),
       ($7, 'UPI Reference Race Player One', $8, 'test-salt', 'test-hash', 'user', 900),
       ($9, 'UPI Reference Race Player Two', $10, 'test-salt', 'test-hash', 'user', 450),
       ($11, 'UPI Reference Protected Deposit Player', $12, 'test-salt', 'test-hash', 'user', 500)`,
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

test("a deleted deposit keeps its normalized UPI reference reserved", async () => {
  const referenceSuffix = randomUUID().replace(/-/g, "").toUpperCase();
  const originalReference = `  ＵＰＩ-ＲＥＦ-ＤＥＬＥＴＥＤ-${referenceSuffix}  `;
  const storedReference = originalReference.trim();
  const normalizedReference = `UPI-REF-DELETED-${referenceSuffix}`;
  const duplicateReference = `upi-ref-deleted-${referenceSuffix.toLowerCase()}`;
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

    const deletion = await call(
      origin,
      fixture.adminId,
      `/admin/payments/${paymentId}`,
      "DELETE",
    );
    assert.equal(deletion.status, 200);
    assert.equal(deletion.body.id, paymentId);
    assert.equal(deletion.body.deleted, true);

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
        WHERE reference_normalized = $1`,
      [normalizedReference],
    );
    assert.deepEqual(payments.rows, [{
      id: paymentId,
      user_id: fixture.playerId,
      status: "deleted",
      reference: storedReference,
      reference_normalized: normalizedReference,
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
