import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import router from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "daily007-wallet-pending-concurrency-test-secret";
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

const playerIds = [randomUUID(), randomUUID(), randomUUID()] as const;
const initialBalance = 700;

type ApiResponse = {
  status: number;
  body: Record<string, unknown>;
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
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

function authHeaders(userId: string): Record<string, string> {
  const token = makeToken(userId, 0);
  assert.ok(token, "The test player must receive a Daily007 session token.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function submitDeposit(
  origin: string,
  userId: string,
  reference: string,
  coins: number,
): Promise<ApiResponse> {
  const response = await fetch(`${origin}/payments`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({ coins, txnId: reference }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function submitWithdrawal(
  origin: string,
  userId: string,
  coins: number,
): Promise<ApiResponse> {
  const response = await fetch(`${origin}/withdrawals`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      coins,
      method: "upi",
      account: `withdrawal-${userId}@upi`,
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function createFixture(): Promise<void> {
  for (const [index, userId] of playerIds.entries()) {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, $2, $3, 'test-salt', 'test-hash', $4)`,
      [
        userId,
        `Pending Concurrency Player ${index + 1}`,
        `pending-concurrency-${userId}@example.test`,
        initialBalance,
      ],
    );
  }
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
      withdrawalEnabled: "true",
      minWithdrawal: "100",
      maxWithdrawal: "5000",
    })],
  );
}

async function cleanupFixture(): Promise<void> {
  await pool.query(
    "DELETE FROM daily007_v2_withdrawals WHERE user_id = ANY($1::uuid[])",
    [playerIds],
  );
  await pool.query(
    "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])",
    [playerIds],
  );
  await pool.query(
    "DELETE FROM daily007_v2_payments WHERE user_id = ANY($1::uuid[])",
    [playerIds],
  );
  await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [playerIds]);
  await pool.query("DELETE FROM daily007_v2_settings WHERE id = 1");
}

async function backendPid(client: Awaited<ReturnType<typeof pool.connect>>): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = result.rows[0]?.pid;
  assert.ok(pid, "PostgreSQL must provide a backend id for the pending-payment blocker.");
  return Number(pid);
}

async function waitForBlockedWithdrawalRequests(
  blockerPid: number,
  expectedCount: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.datname = current_database()
          AND activity.wait_event_type = 'Lock'
          AND activity.query ILIKE $1
        ORDER BY activity.query_start`,
      ["%SELECT wallet_coins FROM daily007_v2_users%"],
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(
        result.rows.length,
        expectedCount,
        "Only the two same-player withdrawal requests should be waiting on the wallet row.",
      );
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.map(Number).includes(blockerPid)),
        "At least one withdrawal request must be waiting directly on the wallet-row blocker.",
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => Number(pid) === blockerPid || requestPids.has(Number(pid))),
        ),
        "Each withdrawal request must be queued behind the blocker or the earlier waiting request.",
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} withdrawal requests to block on the wallet row.`);
}

async function waitForBlockedPaymentRequests(
  blockerPid: number,
  expectedCount: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
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
      assert.equal(
        result.rows.length,
        expectedCount,
        "Only the two same-player deposit requests should be waiting.",
      );
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.map(Number).includes(blockerPid)),
        "At least one deposit request must be waiting directly on the pending-payment blocker.",
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
  throw new Error(`Timed out waiting for ${expectedCount} same-player deposits to block on PostgreSQL.`);
}

async function assertWalletsAndLedgerUnchanged(): Promise<void> {
  const wallets = await pool.query<{ id: string; wallet_coins: number }>(
    "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
    [playerIds],
  );
  const balancesByPlayer = new Map(wallets.rows.map((row) => [row.id, row.wallet_coins]));
  assert.deepEqual(
    playerIds.map((userId) => balancesByPlayer.get(userId)),
    [initialBalance, initialBalance, initialBalance],
  );

  const ledger = await pool.query(
    `SELECT user_id, amount, reason
       FROM daily007_v2_wallet_ledger
      WHERE user_id = ANY($1::uuid[])`,
    [playerIds],
  );
  assert.deepEqual(ledger.rows, []);
}

test("concurrent deposits enforce the PostgreSQL pending limit per player", async () => {
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let samePlayerSubmissions: Promise<ApiResponse>[] = [];

  try {
    await createFixture();

    const independentRequests = [
      {
        userId: playerIds[0],
        coins: 120,
        reference: `independent-${randomUUID()}-1`,
      },
      {
        userId: playerIds[1],
        coins: 200,
        reference: `independent-${randomUUID()}-2`,
      },
    ];
    const samePlayerRequests = [
      {
        userId: playerIds[2],
        coins: 150,
        reference: `same-player-${randomUUID()}-1`,
      },
      {
        userId: playerIds[2],
        coins: 250,
        reference: `same-player-${randomUUID()}-2`,
      },
    ];

    await withServer(async (origin) => {
      const independentResponses = await Promise.all(
        independentRequests.map((request) =>
          submitDeposit(origin, request.userId, request.reference, request.coins),
        ),
      );
      assert.deepEqual(
        independentResponses.map((response) => response.status),
        [201, 201],
      );
      for (const [index, response] of independentResponses.entries()) {
        assert.equal(response.body.status, "pending");
        assert.equal(response.body.txnId, independentRequests[index].reference);
      }

      const independentPayments = await pool.query<{
        user_id: string;
        reference: string;
        status: string;
      }>(
        `SELECT user_id, reference, status
           FROM daily007_v2_payments
          WHERE user_id = ANY($1::uuid[])`,
        [independentRequests.map((request) => request.userId)],
      );
      assert.equal(independentPayments.rows.length, 2);
      for (const request of independentRequests) {
        assert.deepEqual(
          independentPayments.rows.filter((payment) => payment.user_id === request.userId),
          [{
            user_id: request.userId,
            reference: request.reference,
            status: "pending",
          }],
        );
      }
      await assertWalletsAndLedgerUnchanged();

      blocker = await pool.connect();
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      const blockerReference = `blocker-${randomUUID()}`;
      await blocker.query(
        `INSERT INTO daily007_v2_payments
           (user_id, coins, amount, reference, reference_normalized)
         VALUES ($1, 50, 125, $2, $3)`,
        [samePlayerRequests[0].userId, blockerReference, blockerReference.toUpperCase()],
      );
      const blockerPid = await backendPid(blocker);
      samePlayerSubmissions = samePlayerRequests.map((request) =>
        submitDeposit(origin, request.userId, request.reference, request.coins),
      );

      try {
        await waitForBlockedPaymentRequests(blockerPid, 2);
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const samePlayerResponses = await Promise.all(samePlayerSubmissions);
      assert.deepEqual(
        samePlayerResponses.map((response) => response.status).sort((left, right) => left - right),
        [201, 409],
      );
      const accepted = samePlayerResponses.find((response) => response.status === 201);
      const conflict = samePlayerResponses.find((response) => response.status === 409);
      assert.ok(accepted);
      assert.ok(conflict);
      assert.equal(accepted.body.status, "pending");
      assert.ok(samePlayerRequests.some((request) => request.reference === accepted.body.txnId));
      assert.equal(conflict.body.error, "You already have a pending coin recharge request.");

      const samePlayerPayments = await pool.query<{
        id: string;
        reference: string;
        status: string;
      }>(
        `SELECT id, reference, status
           FROM daily007_v2_payments
          WHERE user_id = $1`,
        [samePlayerRequests[0].userId],
      );
      assert.deepEqual(samePlayerPayments.rows, [{
        id: accepted.body.id,
        reference: accepted.body.txnId,
        status: "pending",
      }]);
      await assertWalletsAndLedgerUnchanged();
    });
  } finally {
    if (blockerTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      blockerTransactionOpen = false;
    }
    if (samePlayerSubmissions.length) await Promise.allSettled(samePlayerSubmissions);
    blocker?.release();
    await cleanupFixture();
  }
});

test("concurrent withdrawals reserve a player's wallet only once", async () => {
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let withdrawalSubmissions: Promise<ApiResponse>[] = [];

  try {
    await createFixture();
    const playerId = playerIds[0];
    const requestedCoins = [150, 250] as const;

    await withServer(async (origin) => {
      blocker = await pool.connect();
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [playerId],
      );
      const blockerPid = await backendPid(blocker);

      withdrawalSubmissions = requestedCoins.map((coins) =>
        submitWithdrawal(origin, playerId, coins),
      );

      try {
        await waitForBlockedWithdrawalRequests(blockerPid, 2);
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const responses = await Promise.all(withdrawalSubmissions);
      assert.deepEqual(
        responses.map((response) => response.status).sort((left, right) => left - right),
        [201, 409],
      );

      const acceptedIndex = responses.findIndex((response) => response.status === 201);
      const accepted = responses[acceptedIndex];
      const conflict = responses[1 - acceptedIndex];
      assert.ok(accepted);
      assert.ok(conflict);
      assert.equal(accepted.body.status, "pending");
      assert.equal(
        accepted.body.walletCoins,
        initialBalance - requestedCoins[acceptedIndex],
      );
      assert.equal(
        conflict.body.error,
        "You already have a pending withdrawal request.",
      );
      assert.ok(typeof accepted.body.id === "string");

      const withdrawals = await pool.query<{
        id: string;
        user_id: string;
        coins: number;
        status: string;
      }>(
        `SELECT id, user_id, coins, status
           FROM daily007_v2_withdrawals
          WHERE user_id = $1`,
        [playerId],
      );
      assert.deepEqual(withdrawals.rows, [{
        id: accepted.body.id,
        user_id: playerId,
        coins: requestedCoins[acceptedIndex],
        status: "pending",
      }]);

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [playerId],
      );
      const expectedBalance = initialBalance - requestedCoins[acceptedIndex];
      assert.equal(wallet.rows[0]?.wallet_coins, expectedBalance);

      const ledger = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = ANY($1::uuid[])`,
        [playerIds],
      );
      assert.deepEqual(ledger.rows, [{
        user_id: playerId,
        amount: -requestedCoins[acceptedIndex],
        balance_after: expectedBalance,
        reason: "withdrawal_reserved",
      }]);
    });
  } finally {
    if (blockerTransactionOpen && blocker) {
      await blocker.query("ROLLBACK");
      blockerTransactionOpen = false;
    }
    if (withdrawalSubmissions.length) await Promise.allSettled(withdrawalSubmissions);
    blocker?.release();
    await cleanupFixture();
  }
});
