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
  adminId: randomUUID(),
};

after(async () => {
  try {
    const playerIds = [fixture.playerId, fixture.retryPlayerId];
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
       ($3, 'UPI Reference Test Admin', $6, 'test-salt', 'test-hash', 'admin', 0)`,
    [
      fixture.playerId,
      fixture.retryPlayerId,
      fixture.adminId,
      `wallet-reference-player-${fixture.playerId}@example.test`,
      `wallet-reference-retry-${fixture.retryPlayerId}@example.test`,
      `wallet-reference-admin-${fixture.adminId}@example.test`,
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
  method: "GET" | "POST",
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
