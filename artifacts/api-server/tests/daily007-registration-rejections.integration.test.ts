import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-registration-rejections-postgres-test-secret";
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

type RejectionFixture = {
  userIds: string[];
  playerId: string;
  matchId: string;
  gameUid: string;
};

type DatabaseSnapshot = {
  users: Record<string, unknown>[];
  match: Record<string, unknown>[];
  registrations: Record<string, unknown>[];
  roster: Record<string, unknown>[];
  ledger: Record<string, unknown>[];
};

type RejectionScenario = {
  name: string;
  balance: number;
  full: boolean;
  expectedError: string;
  expectedCode?: string;
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007CompatCoreRouter);
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
  assert.ok(token, "The isolated test player must receive a Daily007 session token.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function registerForMatch(
  origin: string,
  fixture: RejectionFixture,
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${fixture.matchId}/register`, {
    method: "POST",
    headers: authHeaders(fixture.playerId),
    body: JSON.stringify({
      captainGameName: "Rejected Join Test Player",
      captainGameUid: fixture.gameUid,
      teammates: [],
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function createFixture(full: boolean, balance: number): Promise<RejectionFixture> {
  const fixture: RejectionFixture = {
    userIds: [randomUUID()],
    playerId: "",
    matchId: randomUUID(),
    gameUid: `ff-${randomUUID()}`,
  };
  fixture.playerId = fixture.userIds[0];
  const incumbentId = full ? randomUUID() : null;
  if (incumbentId) fixture.userIds.push(incumbentId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Rejected Join Player', $2, 'test-salt', 'test-hash', $3)`,
      [fixture.playerId, `player-${fixture.playerId}@example.test`, balance],
    );
    if (incumbentId) {
      await client.query(
        `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, wallet_coins)
         VALUES ($1, 'Seeded Match Player', $2, 'test-salt', 'test-hash', 93)`,
        [incumbentId, `incumbent-${incumbentId}@example.test`],
      );
    }
    await client.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, game_mode, team_type, capacity, entry_coins, starts_at, status, is_full)
       VALUES ($1, 'Rejected Join Test Match', 'solo', 'battle_royale', 'solo', $2, 7,
               now() + interval '1 day', $3, $4)`,
      [fixture.matchId, full ? 1 : 48, full ? "full" : "open", full],
    );
    if (incumbentId) {
      const registrationId = randomUUID();
      await client.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid, entry_coins_paid, status)
         VALUES ($1, $2, $3, 'Seeded Match Player', 'Seeded Captain', $4, 7, 'approved')`,
        [registrationId, fixture.matchId, incumbentId, `incumbent-${randomUUID()}`],
      );
      await client.query(
        `INSERT INTO daily007_v2_wallet_ledger
           (user_id, amount, balance_after, reason, match_id, registration_id)
         VALUES ($1, -7, 93, 'match_entry', $2, $3)`,
        [incumbentId, fixture.matchId, registrationId],
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

async function snapshotFixture(fixture: RejectionFixture): Promise<DatabaseSnapshot> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const users = await client.query<{ row: Record<string, unknown> }>(
      "SELECT to_jsonb(u) AS row FROM daily007_v2_users u WHERE id = ANY($1::uuid[]) ORDER BY id",
      [fixture.userIds],
    );
    const match = await client.query<{ row: Record<string, unknown> }>(
      "SELECT to_jsonb(m) AS row FROM daily007_v2_matches m WHERE id = $1",
      [fixture.matchId],
    );
    const registrations = await client.query<{ row: Record<string, unknown> }>(
      "SELECT to_jsonb(r) AS row FROM daily007_v2_registrations r WHERE match_id = $1 ORDER BY id",
      [fixture.matchId],
    );
    const roster = await client.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(roster) AS row
         FROM daily007_v2_roster roster
         JOIN daily007_v2_registrations registration ON registration.id = roster.registration_id
        WHERE registration.match_id = $1
        ORDER BY roster.registration_id, roster.position`,
      [fixture.matchId],
    );
    const ledger = await client.query<{ row: Record<string, unknown> }>(
      `SELECT to_jsonb(ledger) AS row
         FROM daily007_v2_wallet_ledger ledger
        WHERE ledger.match_id = $1 OR ledger.user_id = ANY($2::uuid[])
        ORDER BY ledger.id`,
      [fixture.matchId, fixture.userIds],
    );
    await client.query("COMMIT");
    return {
      users: users.rows.map(({ row }) => row),
      match: match.rows.map(({ row }) => row),
      registrations: registrations.rows.map(({ row }) => row),
      roster: roster.rows.map(({ row }) => row),
      ledger: ledger.rows.map(({ row }) => row),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupFixture(fixture: RejectionFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE match_id = $1 OR user_id = ANY($2::uuid[])",
      [fixture.matchId, fixture.userIds],
    );
    await client.query(
      `DELETE FROM daily007_v2_roster
        WHERE registration_id IN (
          SELECT id FROM daily007_v2_registrations WHERE match_id = $1
        )`,
      [fixture.matchId],
    );
    await client.query("DELETE FROM daily007_v2_registrations WHERE match_id = $1", [fixture.matchId]);
    await client.query("DELETE FROM daily007_v2_matches WHERE id = $1", [fixture.matchId]);
    await client.query("DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])", [fixture.userIds]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedPaidRegistrationForConcurrentRejection(
  fixture: RejectionFixture,
): Promise<{ registrationId: string; adminIds: [string, string] }> {
  const registrationId = randomUUID();
  const adminIds: [string, string] = [randomUUID(), randomUUID()];
  fixture.userIds.push(...adminIds);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const adminId of adminIds) {
      await client.query(
        `INSERT INTO daily007_v2_users
           (id, name, email, password_salt, password_hash, role)
         VALUES ($1, 'Registration Rejection Admin', $2, 'test-salt', 'test-hash', 'tournament_admin')`,
        [adminId, `admin-${adminId}@example.test`],
      );
    }
    await client.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, captain_name, captain_game_name, captain_game_uid, entry_coins_paid, status)
       VALUES ($1, $2, $3, 'Rejected Join Player', 'Seeded Captain', $4, 7, 'approved')`,
      [registrationId, fixture.matchId, fixture.playerId, fixture.gameUid],
    );
    await client.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, match_id, registration_id)
       VALUES ($1, -7, 93, 'match_entry', $2, $3)`,
      [fixture.playerId, fixture.matchId, registrationId],
    );
    await client.query("COMMIT");
    return { registrationId, adminIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function rejectRegistration(
  origin: string,
  registrationId: string,
  adminId: string,
): Promise<RegistrationResponse> {
  const response = await fetch(
    `${origin}/admin/registrations/${registrationId}/reject`,
    { method: "POST", headers: authHeaders(adminId) },
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function waitForBlockedRejectionRequests(
  blockerPid: number,
  expectedCount: number,
  priorWaiterPids: number[] = [],
): Promise<number[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blocker_pids: number[] }>(
      `SELECT waiting.pid, pg_blocking_pids(waiting.pid) AS blocker_pids
         FROM pg_stat_activity AS waiting
        WHERE waiting.pid <> pg_backend_pid()
          AND waiting.wait_event_type = 'Lock'
           AND waiting.query ILIKE '%FROM daily007_v2_matches%'
           AND waiting.query ILIKE '%FOR UPDATE%'
        ORDER BY waiting.query_start`,
    );
    const waiters = result.rows.slice(0, expectedCount);
    const knownBlockers = new Set([blockerPid, ...priorWaiterPids]);
    if (
      waiters.length >= expectedCount &&
      waiters.every(({ blocker_pids }) => blocker_pids.some((pid) => knownBlockers.has(pid)))
    ) {
      return waiters.map(({ pid }) => pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${expectedCount} rejection requests to queue on the match lock.`);
}

const rejectedJoins: RejectionScenario[] = [
  {
    name: "insufficient wallet balance",
    balance: 6,
    full: false,
    expectedError: "Insufficient wallet balance: this entry costs 7 coins.",
  },
  {
    name: "a full match",
    balance: 100,
    full: true,
    expectedError: "This match is already full and is not accepting registrations.",
    expectedCode: "MATCH_FULL",
  },
];

test("PostgreSQL rejected tournament joins preserve the player's balance, registrations, and wallet ledger", async (t) => {
  await withServer(async (origin) => {
    for (const scenario of rejectedJoins) {
      await t.test(scenario.name, async () => {
        const fixture = await createFixture(scenario.full, scenario.balance);
        try {
          const before = await snapshotFixture(fixture);
          assert.equal(before.users.length, fixture.userIds.length, "all seeded players must exist");
          assert.equal(before.match.length, 1, "the seeded match must exist");

          const response = await registerForMatch(origin, fixture);

          assert.equal(response.status, 409);
          assert.equal(response.body.error, scenario.expectedError);
          if (scenario.expectedCode) assert.equal(response.body.code, scenario.expectedCode);
          assert.deepEqual(
            await snapshotFixture(fixture),
            before,
            "a rejected join must not change accounts, match state, registrations, roster, or wallet ledger",
          );
        } finally {
          await cleanupFixture(fixture);
        }
      });
    }
  });
});

test("concurrent PostgreSQL registration rejections refund a paid entry only once", async () => {
  const fixture = await createFixture(false, 93);
  const { registrationId, adminIds } = await seedPaidRegistrationForConcurrentRejection(fixture);
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  const submissions: Promise<RegistrationResponse>[] = [];

  try {
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    blockerTransactionOpen = true;
    await blocker.query("SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE", [fixture.matchId]);
    const blockerPidResult = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const blockerPid = blockerPidResult.rows[0]?.pid;
    assert.ok(blockerPid, "the match-lock blocker must have a PostgreSQL backend");

    await withServer(async (origin) => {
      try {
        submissions.push(rejectRegistration(origin, registrationId, adminIds[0]));
        const firstWaiterPids = await waitForBlockedRejectionRequests(blockerPid, 1);

        submissions.push(rejectRegistration(origin, registrationId, adminIds[1]));
        await waitForBlockedRejectionRequests(blockerPid, 2, firstWaiterPids);

        await blocker!.query("COMMIT");
        blockerTransactionOpen = false;

        const responses = await Promise.all(submissions);
        assert.deepEqual(
          responses.map(({ status, body }) => ({ status, body })),
          [
            { status: 200, body: { success: true, data: { id: registrationId, status: "rejected", refunded: true } } },
            { status: 200, body: { success: true, data: { id: registrationId, status: "rejected", refunded: true } } },
          ],
          "both administrators' requests should settle successfully",
        );
      } finally {
        if (blockerTransactionOpen) {
          await blocker!.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
        await Promise.allSettled(submissions);
      }
    });

    const snapshot = await snapshotFixture(fixture);
    assert.equal(snapshot.users.find((user) => user.id === fixture.playerId)?.wallet_coins, 100);
    assert.deepEqual(
      snapshot.registrations.map((registration) => registration.status),
      ["rejected"],
    );
    assert.equal(
      snapshot.ledger.filter((entry) => entry.reason === "registration_refund").length,
      1,
      "the paid registration must have exactly one refund ledger entry",
    );
  } finally {
    if (blockerTransactionOpen) await blocker?.query("ROLLBACK");
    blocker?.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});
