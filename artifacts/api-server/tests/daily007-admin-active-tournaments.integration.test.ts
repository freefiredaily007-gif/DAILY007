import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import router from "../src/routes/daily007-compat-extra";

const testDatabaseUrl = process.env.DATABASE_URL
  ? new URL(process.env.DATABASE_URL)
  : null;
const testDatabasePort = process.env.DAILY007_TEST_POSTGRES_PORT;

if (
  process.env.DAILY007_ISOLATED_POSTGRES_TEST !== "1" ||
  !testDatabaseUrl ||
  testDatabaseUrl.hostname !== "127.0.0.1" ||
  testDatabaseUrl.pathname !== "/postgres" ||
  testDatabaseUrl.port !== testDatabasePort
) {
  throw new Error(
    "This integration test must run through the isolated PostgreSQL test runner.",
  );
}

const TEST_AUTH_SECRET = "daily007-admin-active-tournaments-test-secret";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(async () => {
  await pool.end();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

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

test("admin overview counts only enabled, non-cancelled tournaments without a published winner", async () => {
  const adminId = randomUUID();
  const futureOpen = randomUUID();
  const ongoingFull = randomUUID();
  const cancelled = randomUUID();
  const disabled = randomUUID();
  const completed = randomUUID();
  const cancelledEnabled = randomUUID();
  const winnerStillEnabled = randomUUID();

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, role, wallet_coins, status, auth_version)
       VALUES ($1, 'Stats Test Admin', $2, 'admin', 0, 'active', 0)`,
      [adminId, `admin-${adminId}@example.test`],
    );
    await pool.query(
      `INSERT INTO daily007_v2_matches (id, enabled, status, starts_at)
       VALUES
         ($1, true, 'open', now() + interval '1 day'),
         ($2, true, 'full', now() - interval '1 hour'),
         ($3, false, 'cancelled', now() - interval '1 day'),
         ($4, false, 'open', now() - interval '1 day'),
         ($5, false, 'full', now() - interval '1 day'),
         ($6, true, 'cancelled', now() - interval '1 day'),
         ($7, true, 'open', now() - interval '1 hour')`,
      [futureOpen, ongoingFull, cancelled, disabled, completed, cancelledEnabled, winnerStillEnabled],
    );
    await pool.query(
      "INSERT INTO daily007_v2_result_awards (match_id, rank, prize_coins) VALUES ($1, 1, 20), ($2, 1, 10)",
      [completed, winnerStillEnabled],
    );

    const token = makeToken(adminId, 0);
    assert.ok(token, "test admin should receive a Daily007 session token");

    await withServer(async (origin) => {
      const response = await fetch(`${origin}/admin/stats`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as { stats: { activeTournaments: number; completedTournaments: number } };
      assert.equal(body.stats.activeTournaments, 2);
      assert.equal(body.stats.completedTournaments, 1);
    });
  } finally {
    await pool.query("DELETE FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])", [
      [completed, winnerStillEnabled],
    ]);
    await pool.query("DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])", [
      [futureOpen, ongoingFull, cancelled, disabled, completed, cancelledEnabled, winnerStillEnabled],
    ]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
  }
});
