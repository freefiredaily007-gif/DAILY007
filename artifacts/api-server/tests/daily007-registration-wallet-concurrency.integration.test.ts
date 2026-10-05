import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-registration-wallet-concurrency-test-secret";
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

type RegistrationResponse = {
  status: number;
  body: Record<string, unknown>;
};

type WalletRaceFixture = {
  userId: string;
  matchIds: [string, string];
  gameUids: [string, string];
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use((
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({
      error: "Test server encountered an unexpected error.",
      detail: error instanceof Error ? error.message : String(error),
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

async function registerForMatch(
  origin: string,
  userId: string,
  matchId: string,
  gameUid: string,
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/register`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      captainGameName: "Concurrent Test Player",
      captainGameUid: gameUid,
      teammates: [],
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function createFixture(): Promise<WalletRaceFixture> {
  const fixture: WalletRaceFixture = {
    userId: randomUUID(),
    matchIds: [randomUUID(), randomUUID()],
    gameUids: [`ff-${randomUUID()}`, `ff-${randomUUID()}`],
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Wallet Race Player', $2, 'test-salt', 'test-hash', 100)`,
      [fixture.userId, `player-${fixture.userId}@example.test`],
    );
    for (const [index, matchId] of fixture.matchIds.entries()) {
      await client.query(
        `INSERT INTO daily007_v2_matches
           (id, title, mode, game_mode, team_type, capacity, entry_coins, starts_at, status)
         VALUES ($1, $2, 'solo', 'battle_royale', 'solo', 48, 7, now() + interval '1 day', 'open')`,
        [matchId, `Wallet race tournament ${index + 1}`],
      );
    }
    await client.query("COMMIT");
    return fixture;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(fixture: WalletRaceFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1 OR match_id = ANY($2::uuid[])",
      [fixture.userId, fixture.matchIds],
    );
    await client.query(
      `DELETE FROM daily007_v2_roster
        WHERE registration_id IN (
          SELECT id FROM daily007_v2_registrations WHERE match_id = ANY($1::uuid[])
        )`,
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_registrations WHERE match_id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query("DELETE FROM daily007_v2_users WHERE id = $1", [fixture.userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function backendPid(client: { query<T>(sql: string): Promise<{ rows: T[] }> }): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = result.rows[0]?.pid;
  assert.ok(pid, "PostgreSQL must provide a backend id for the wallet lock holder.");
  return Number(pid);
}

async function waitForBlockedWalletRequests(blockerPid: number, expectedCount: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query ILIKE $1
        ORDER BY activity.query_start`,
      ["%SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE%"],
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(result.rows.length, expectedCount, "Only the two competing tournament joins should be waiting.");
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.map(Number).includes(blockerPid)),
        "At least one tournament join must be waiting directly on the test wallet lock.",
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => Number(pid) === blockerPid || requestPids.has(Number(pid))),
        ),
        "Each join must be queued behind the test lock or the earlier waiting join.",
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} tournament joins to block on the wallet row.`);
}

test("concurrent joins to separate tournaments serialize on the PostgreSQL wallet row", async () => {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture();
    fixtureForCleanup = fixture;
    const blocker = await pool.connect();
    blockerForCleanup = blocker;

    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [fixture.userId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = fixture.matchIds.map((matchId, index) =>
        registerForMatch(origin, fixture.userId, matchId, fixture.gameUids[index]),
      );

      try {
        await waitForBlockedWalletRequests(blockerPid, 2);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const responses = await Promise.all(submissions);
      assert.deepEqual(
        responses.map((response) => response.status),
        [201, 201],
        `unexpected registration responses: ${JSON.stringify(responses)}`,
      );
      assert.deepEqual(
        responses.map((response) => Number(response.body.walletCoins)).sort((left, right) => left - right),
        [86, 93],
        "each response should reflect a serialized 7-coin deduction",
      );

      const registrations = await pool.query<{
        id: string;
        match_id: string;
        captain_user_id: string;
        captain_game_uid: string;
        entry_coins_paid: number;
        status: string;
      }>(
        `SELECT id, match_id, captain_user_id, captain_game_uid, entry_coins_paid, status
           FROM daily007_v2_registrations
          WHERE match_id = ANY($1::uuid[]) AND captain_user_id = $2
          ORDER BY match_id`,
        [fixture.matchIds, fixture.userId],
      );
      assert.equal(registrations.rows.length, 2, "both tournament entries must be stored");
      assert.deepEqual(
        new Set(registrations.rows.map((registration) => registration.match_id)),
        new Set(fixture.matchIds),
      );
      for (const [index, matchId] of fixture.matchIds.entries()) {
        const registration = registrations.rows.find((entry) => entry.match_id === matchId);
        assert.ok(registration, `registration for ${matchId} must exist`);
        assert.equal(registration.captain_user_id, fixture.userId);
        assert.equal(registration.captain_game_uid, fixture.gameUids[index]);
        assert.equal(registration.entry_coins_paid, 7);
        assert.equal(registration.status, "approved");
        assert.equal(responses[index].body.registrationId, registration.id);
      }

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      assert.deepEqual(wallet.rows, [{ wallet_coins: 86 }], "the player should pay exactly two entry fees");

      const ledger = await pool.query<{
        match_id: string;
        registration_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1 AND match_id = ANY($2::uuid[])
          ORDER BY balance_after DESC`,
        [fixture.userId, fixture.matchIds],
      );
      assert.equal(ledger.rows.length, 2, "there must be one wallet ledger entry per tournament");
      assert.deepEqual(
        new Set(ledger.rows.map((entry) => entry.match_id)),
        new Set(fixture.matchIds),
      );
      assert.deepEqual(
        ledger.rows.map((entry) => entry.balance_after).sort((left, right) => left - right),
        [86, 93],
        "ledger balances must record both sequential wallet states",
      );
      for (const entry of ledger.rows) {
        assert.equal(entry.amount, -7);
        assert.equal(entry.reason, "match_entry");
        const registration = registrations.rows.find((row) => row.match_id === entry.match_id);
        assert.ok(registration);
        assert.equal(entry.registration_id, registration.id);
      }
    });
  } finally {
    try {
      if (blockerForCleanup && blockerTransactionOpen) {
        await blockerForCleanup.query("ROLLBACK");
        blockerTransactionOpen = false;
      }
    } finally {
      blockerForCleanup?.release();
      await Promise.allSettled(submissions);
      if (fixtureForCleanup) await cleanupFixture(fixtureForCleanup);
    }
  }
});
