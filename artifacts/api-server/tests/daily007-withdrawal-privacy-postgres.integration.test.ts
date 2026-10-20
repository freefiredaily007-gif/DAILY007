import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import router from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "daily007-withdrawal-privacy-postgres-test-secret";
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
  firstPlayerId: randomUUID(),
  secondPlayerId: randomUUID(),
  adminId: randomUUID(),
};
const playerIds = [fixture.firstPlayerId, fixture.secondPlayerId];
const firstPayoutAccount = `withdrawal-owner-${fixture.firstPlayerId}@upi`;
const secondPayoutAccount = `withdrawal-owner-${fixture.secondPlayerId}-bank`;
const secondReviewReason = "Payout account details could not be verified.";

type ApiResponse = { status: number; body: any };

after(async () => {
  try {
    await pool.query(
      "DELETE FROM daily007_v2_withdrawals WHERE user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await pool.query(
      "DELETE FROM daily007_v2_notifications WHERE user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await pool.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[...playerIds, fixture.adminId]],
    );
    await pool.query("DELETE FROM daily007_v2_settings WHERE id = 1");
  } finally {
    if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
    else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
    await pool.end();
  }
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
): Promise<ApiResponse> {
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

async function seedFixture(): Promise<void> {
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins)
     VALUES
       ($1, 'Withdrawal Privacy Player One', $4, 'test-salt', 'test-hash', 'user', 700),
       ($2, 'Withdrawal Privacy Player Two', $5, 'test-salt', 'test-hash', 'user', 900),
       ($3, 'Withdrawal Privacy Admin', $6, 'test-salt', 'test-hash', 'admin', 0)`,
    [
      fixture.firstPlayerId,
      fixture.secondPlayerId,
      fixture.adminId,
      `withdrawal-privacy-${fixture.firstPlayerId}@example.test`,
      `withdrawal-privacy-${fixture.secondPlayerId}@example.test`,
      `withdrawal-privacy-${fixture.adminId}@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO daily007_v2_settings (id, settings)
     VALUES (1, $1::jsonb)`,
    [JSON.stringify({
      withdrawalEnabled: "true",
      minWithdrawal: "100",
      maxWithdrawal: "5000",
    })],
  );
}

test("PostgreSQL withdrawal history exposes approved and rejected payout details only to each owner", async () => {
  await seedFixture();

  await withServer(async (origin) => {
    const firstCreated = await call(origin, fixture.firstPlayerId, "/withdrawals", "POST", {
      coins: 150,
      method: "upi",
      account: firstPayoutAccount,
    });
    const secondCreated = await call(origin, fixture.secondPlayerId, "/withdrawals", "POST", {
      coins: 250,
      method: "bank",
      account: secondPayoutAccount,
    });
    assert.equal(firstCreated.status, 201, JSON.stringify(firstCreated.body));
    assert.equal(secondCreated.status, 201, JSON.stringify(secondCreated.body));
    const firstWithdrawalId = firstCreated.body.id as string;
    const secondWithdrawalId = secondCreated.body.id as string;
    assert.notEqual(firstWithdrawalId, secondWithdrawalId);

    const approved = await call(
      origin,
      fixture.adminId,
      `/admin/withdrawals/${firstWithdrawalId}/approve`,
      "POST",
    );
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const rejected = await call(
      origin,
      fixture.adminId,
      `/admin/withdrawals/${secondWithdrawalId}/reject`,
      "POST",
      { reason: secondReviewReason },
    );
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.status, "rejected");
    assert.equal(rejected.body.review_reason, secondReviewReason);

    const repeatedRejection = await call(
      origin,
      fixture.adminId,
      `/admin/withdrawals/${secondWithdrawalId}/reject`,
      "POST",
      { reason: secondReviewReason },
    );
    assert.equal(repeatedRejection.status, 200, JSON.stringify(repeatedRejection.body));
    assert.equal(repeatedRejection.body.alreadyReviewed, true);

    const [firstHistory, secondHistory] = await Promise.all([
      call(origin, fixture.firstPlayerId, "/my/withdrawals", "GET"),
      call(origin, fixture.secondPlayerId, "/my/withdrawals", "GET"),
    ]);
    assert.equal(firstHistory.status, 200, JSON.stringify(firstHistory.body));
    assert.equal(secondHistory.status, 200, JSON.stringify(secondHistory.body));
    assert.equal(firstHistory.body.length, 1);
    assert.equal(secondHistory.body.length, 1);

    const firstWithdrawal = firstHistory.body[0];
    const secondWithdrawal = secondHistory.body[0];
    assert.equal(firstWithdrawal.id, firstWithdrawalId);
    assert.equal(firstWithdrawal.coins, 150);
    assert.equal(firstWithdrawal.method, "upi");
    assert.equal(firstWithdrawal.account, firstPayoutAccount);
    assert.equal(firstWithdrawal.status, "approved");
    assert.equal(firstWithdrawal.payoutStatus, "manual_payout_required");
    assert.equal(firstWithdrawal.reviewReason, null);
    assert.equal(Date.parse(firstWithdrawal.createdAt) > 0, true);
    assert.equal(Date.parse(firstWithdrawal.reviewedAt) > 0, true);

    assert.equal(secondWithdrawal.id, secondWithdrawalId);
    assert.equal(secondWithdrawal.coins, 250);
    assert.equal(secondWithdrawal.method, "bank");
    assert.equal(secondWithdrawal.account, secondPayoutAccount);
    assert.equal(secondWithdrawal.status, "rejected");
    assert.equal(secondWithdrawal.payoutStatus, "not_paid");
    assert.equal(secondWithdrawal.reviewReason, secondReviewReason);
    assert.equal(Date.parse(secondWithdrawal.reviewedAt) > 0, true);

    const firstHistoryJson = JSON.stringify(firstHistory.body);
    const secondHistoryJson = JSON.stringify(secondHistory.body);
    assert.equal(firstHistoryJson.includes(secondWithdrawalId), false);
    assert.equal(firstHistoryJson.includes(secondPayoutAccount), false);
    assert.equal(secondHistoryJson.includes(firstWithdrawalId), false);
    assert.equal(secondHistoryJson.includes(firstPayoutAccount), false);
    assert.equal(secondHistoryJson.includes('"status":"approved"'), false);
    assert.equal(secondHistoryJson.includes('"payoutStatus":"manual_payout_required"'), false);
    assert.equal(firstHistoryJson.includes(secondReviewReason), false);
    assert.equal(firstHistoryJson.includes('"status":"rejected"'), false);

    const refundRows = await pool.query<{ refund_count: number; refund_amount: number; balance_after: number }>(
      `SELECT count(*)::int AS refund_count,
              COALESCE(sum(amount), 0)::int AS refund_amount,
              COALESCE(max(balance_after), 0)::int AS balance_after
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND reason = 'withdrawal_rejected_refund'`,
      [fixture.secondPlayerId],
    );
    assert.equal(refundRows.rows[0]?.refund_count, 1);
    assert.equal(refundRows.rows[0]?.refund_amount, 250);
    assert.equal(refundRows.rows[0]?.balance_after, 900);

    const secondWallet = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.secondPlayerId],
    );
    assert.equal(secondWallet.rows[0]?.wallet_coins, 900);
  });
});
