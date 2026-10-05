import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import compatExtraRouter from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "daily007-admin-revocation-race-test-secret-at-least-32-chars";
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

type JsonResponse = {
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
  app.use(compatExtraRouter);
  app.use((
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: "Test server encountered an unexpected error." });
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
  assert.ok(token, "The test account must receive a Daily007 session token.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function patchJson(
  origin: string,
  path: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<JsonResponse> {
  const response = await fetch(`${origin}${path}`, {
    method: "PATCH",
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function waitForBlockedQuery(fragment: string, description: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM pg_stat_activity
          WHERE pid <> pg_backend_pid()
            AND wait_event_type = 'Lock'
            AND query ILIKE $1
       ) AS waiting`,
      [`%${fragment}%`],
    );
    if (result.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for the ${description} to block in PostgreSQL.`);
}

test("an in-flight admin mutation commits before demotion, and later mutations are rejected", async () => {
  const actorId = randomUUID();
  const demoterId = randomUUID();
  const targetId = randomUUID();
  const pauseKey = 740075n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let mutationPromise: Promise<JsonResponse> | undefined;
  let demotionPromise: Promise<JsonResponse> | undefined;

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES
         ($1, 'In-flight Admin', $2, 'test-salt', 'test-hash', 'admin', 0),
         ($3, 'Demoting Admin', $4, 'test-salt', 'test-hash', 'admin', 0),
         ($5, 'Wallet Target', $6, 'test-salt', 'test-hash', 'user', 100)`,
      [
        actorId, `actor-${actorId}@example.test`,
        demoterId, `demoter-${demoterId}@example.test`,
        targetId, `target-${targetId}@example.test`,
      ],
    );
    await pool.query("CREATE TABLE daily007_test_paused_users (id uuid PRIMARY KEY)");
    await pool.query(`
      CREATE FUNCTION daily007_test_pause_wallet_update() RETURNS trigger AS $$
      BEGIN
        IF NEW.wallet_coins IS DISTINCT FROM OLD.wallet_coins
           AND EXISTS (SELECT 1 FROM daily007_test_paused_users WHERE id = NEW.id) THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_wallet_update
      BEFORE UPDATE ON daily007_v2_users
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_wallet_update()
    `);
    await pool.query("INSERT INTO daily007_test_paused_users (id) VALUES ($1)", [targetId]);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);

    await withServer(async (origin) => {
      mutationPromise = patchJson(origin, `/admin/users/${targetId}`, actorId, {
        coinsDelta: 25,
        reason: "controlled race",
      });
      await waitForBlockedQuery(
        "UPDATE daily007_v2_users SET status = COALESCE",
        "the already-authorized wallet mutation",
      );

      demotionPromise = patchJson(origin, `/admin/users/${actorId}/role`, demoterId, {
        role: "tournament_admin",
      });
      await waitForBlockedQuery(
        "SELECT pg_advisory_xact_lock(740073)",
        "the role-change advisory lock",
      );

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      const [mutation, demotion] = await Promise.all([mutationPromise, demotionPromise]);
      assert.equal(mutation.status, 200, JSON.stringify(mutation.body));
      assert.equal(demotion.status, 200, JSON.stringify(demotion.body));

      const laterMutation = await patchJson(origin, `/admin/users/${targetId}`, actorId, {
        coinsDelta: 1,
        reason: "must be rejected",
      });
      assert.equal(laterMutation.status, 403);
    });

    const actor = await pool.query<{ role: string }>(
      "SELECT role FROM daily007_v2_users WHERE id = $1",
      [actorId],
    );
    const target = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [targetId],
    );
    const ledger = await pool.query<{ amount: number; reason: string }>(
      "SELECT amount, reason FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [targetId],
    );
    assert.equal(actor.rows[0]?.role, "tournament_admin");
    assert.equal(target.rows[0]?.wallet_coins, 125);
    assert.deepEqual(ledger.rows, [{ amount: 25, reason: "admin_adjustment:controlled race" }]);
  } finally {
    if (blocker) {
      await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`).catch(() => undefined);
      blocker.release();
    }
    if (mutationPromise || demotionPromise) {
      await Promise.allSettled([mutationPromise, demotionPromise].filter(Boolean) as Promise<JsonResponse>[]);
    }
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_pause_wallet_update ON daily007_v2_users");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_wallet_update()");
    await pool.query("DROP TABLE IF EXISTS daily007_test_paused_users");
    await pool.query("DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1", [targetId]);
    await pool.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [[actorId, demoterId, targetId]]);
  }
});