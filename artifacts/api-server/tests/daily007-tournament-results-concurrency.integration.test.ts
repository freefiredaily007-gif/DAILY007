import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import compatCoreRouter from "../src/routes/daily007-compat-core";
import compatExtraRouter from "../src/routes/daily007-compat-extra";

const TEST_AUTH_SECRET = "tournament-results-concurrency-tests-only-secret-at-least-32-chars";
const MAX_SUPPORTED_DATABASE_INT = 2_147_483_647;
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

type ResultResponse = {
  status: number;
  body: Record<string, unknown>;
};

type PlayerFixture = {
  userId: string;
  registrationId: string;
  gameUid: string;
};

type TournamentFixture = {
  adminId: string;
  matchId: string;
  players: [PlayerFixture, PlayerFixture, ...PlayerFixture[]];
};

type SharedPlayerPayoutFixture = {
  adminId: string;
  playerId: string;
  matchIds: [string, string];
  registrations: [PlayerFixture, PlayerFixture];
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});


type ServerFaults = {
  dropNextPublishedResultResponse?: boolean;
  failNextResultLogRefresh?: boolean;
};

async function withServer(
  run: (origin: string) => Promise<void>,
  configuredFaults: ServerFaults = {},
): Promise<void> {
  const faults = { ...configuredFaults };
  const app = express();
  app.use(express.json());
  app.use((request, response, next) => {
    if (
      faults.failNextResultLogRefresh &&
      request.method === "GET" &&
      request.path === "/admin/results" &&
      request.query.includeUnfinalized === "true"
    ) {
      faults.failNextResultLogRefresh = false;
      return response.status(503).json({ error: "Simulated result-log refresh failure." });
    }

    if (
      faults.dropNextPublishedResultResponse &&
      request.method === "POST" &&
      request.path === "/admin/results"
    ) {
      const sendJson = response.json.bind(response);
      response.json = ((body: unknown) => {
        if (response.statusCode === 201) {
          faults.dropNextPublishedResultResponse = false;
          response.socket?.destroy();
          return response;
        }
        return sendJson(body);
      }) as typeof response.json;
    }

    next();
  });
  app.use(compatCoreRouter);
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
  assert.ok(token, "The test admin must receive a Daily007 session token.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

test("authenticated /me/stats totals match approved saved registrations and result awards", async () => {
  const playerOneId = randomUUID();
  const playerTwoId = randomUUID();
  const playerIds = [playerOneId, playerTwoId];
  const matchIds = [randomUUID(), randomUUID(), randomUUID()];
  const registrationIds = Array.from({ length: 5 }, () => randomUUID());

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash)
       VALUES ($1, 'Stats Player One', $2, 'test-salt', 'test-hash'),
              ($3, 'Stats Player Two', $4, 'test-salt', 'test-hash')`,
      [playerOneId, `stats-${playerOneId}@example.test`, playerTwoId, `stats-${playerTwoId}@example.test`],
    );
    for (const [index, matchId] of matchIds.entries()) {
      await pool.query(
        `INSERT INTO daily007_v2_matches
           (id, title, mode, capacity, starts_at)
         VALUES ($1, $2, 'solo', 48, now() - interval '1 hour')`,
        [matchId, `Profile Stats Match ${index + 1}`],
      );
    }

    const registrations = [
      { id: registrationIds[0]!, matchId: matchIds[0]!, userId: playerOneId, status: "approved", name: "Stats Player One" },
      { id: registrationIds[1]!, matchId: matchIds[1]!, userId: playerOneId, status: "approved", name: "Stats Player One" },
      { id: registrationIds[2]!, matchId: matchIds[2]!, userId: playerOneId, status: "pending", name: "Stats Player One" },
      { id: registrationIds[3]!, matchId: matchIds[0]!, userId: playerTwoId, status: "approved", name: "Stats Player Two" },
      { id: registrationIds[4]!, matchId: matchIds[1]!, userId: playerTwoId, status: "approved", name: "Stats Player Two" },
    ];
    for (const registration of registrations) {
      await pool.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, captain_name, captain_game_uid,
            entry_coins_paid, status)
         VALUES ($1, $2, $3, $4, $5, 0, $6)`,
        [
          registration.id,
          registration.matchId,
          registration.userId,
          registration.name,
          `uid-${registration.id}`,
          registration.status,
        ],
      );
    }

    const awards = [
      { registrationId: registrationIds[0]!, matchId: matchIds[0]!, userId: playerOneId, rank: 1, kills: 4, prizeCoins: 700 },
      { registrationId: registrationIds[1]!, matchId: matchIds[1]!, userId: playerOneId, rank: 3, kills: 6, prizeCoins: 75 },
      { registrationId: registrationIds[3]!, matchId: matchIds[0]!, userId: playerTwoId, rank: 2, kills: 3, prizeCoins: 100 },
      { registrationId: registrationIds[4]!, matchId: matchIds[1]!, userId: playerTwoId, rank: 1, kills: 9, prizeCoins: 500 },
    ];
    for (const award of awards) {
      await pool.query(
        `INSERT INTO daily007_v2_result_awards
           (match_id, registration_id, user_id, rank, kills, prize_coins)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          award.matchId,
          award.registrationId,
          award.userId,
          award.rank,
          award.kills,
          award.prizeCoins,
        ],
      );
    }

    await withServer(async (origin) => {
      for (const [playerId, expected] of [
        [playerOneId, { matches: 2, wins: 1, kills: 10, prizeCoins: 775 }],
        [playerTwoId, { matches: 2, wins: 1, kills: 12, prizeCoins: 600 }],
      ] as const) {
        const response = await fetch(`${origin}/me/stats`, {
          headers: authHeaders(playerId),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(
          await response.json(),
          expected,
          "the authenticated stats response should aggregate only this player's saved rows",
        );
      }
    });
  } finally {
    await pool.query(
      "DELETE FROM daily007_v2_result_awards WHERE user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await pool.query(
      "DELETE FROM daily007_v2_registrations WHERE captain_user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await pool.query(
      "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [matchIds],
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [playerIds],
    );
  }
});

async function submitResult(
  origin: string,
  adminId: string,
  matchId: string,
  player: PlayerFixture,
  rank: number,
  kills: number,
): Promise<ResultResponse> {
  const response = await fetch(`${origin}/admin/results`, {
    method: "POST",
    headers: authHeaders(adminId),
    body: JSON.stringify({
      tournamentId: matchId,
      registrationId: player.registrationId,
      rank,
      kills,
      prizeCoins: 0,
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function createFixture(playerCount = 2): Promise<TournamentFixture> {
  if (!Number.isSafeInteger(playerCount) || playerCount < 2) {
    throw new Error("A tournament result fixture requires at least two players.");
  }
  const fixture: TournamentFixture = {
    adminId: randomUUID(),
    matchId: randomUUID(),
    players: Array.from({ length: playerCount }, () => ({
      userId: randomUUID(),
      registrationId: randomUUID(),
      gameUid: `uid-${randomUUID()}`,
    })) as TournamentFixture["players"],
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES ($1, 'Concurrency Test Admin', $2, 'test-salt', 'test-hash', 'admin', 0)`,
      [fixture.adminId, `admin-${fixture.adminId}@example.test`],
    );
    for (const [index, player] of fixture.players.entries()) {
      await client.query(
        `INSERT INTO daily007_v2_users
           (id, name, email, password_salt, password_hash, wallet_coins)
         VALUES ($1, $2, $3, 'test-salt', 'test-hash', 100)`,
        [player.userId, `Test Player ${index + 1}`, `player-${player.userId}@example.test`],
      );
    }
    await client.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, game_mode, team_type, capacity, prize_pool, prize_distribution, starts_at)
       VALUES ($1, 'Isolated result race', 'solo', 'battle_royale', 'solo', 48,
                875, '1st: 500 coins\n2nd: 250 coins\n3rd: 125 coins', now() - interval '1 hour')`,
      [fixture.matchId],
    );
    for (const [index, player] of fixture.players.entries()) {
      await client.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, captain_name, captain_game_name,
            captain_game_uid, team_name, entry_coins_paid, status)
         VALUES ($1, $2, $3, $4, $5, $6, '', 0, 'approved')`,
        [
          player.registrationId,
          fixture.matchId,
          player.userId,
          `Test Player ${index + 1}`,
          `TestGame${index + 1}`,
          player.gameUid,
        ],
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

async function createSharedPlayerPayoutFixture(): Promise<SharedPlayerPayoutFixture> {
  const playerId = randomUUID();
  const fixture: SharedPlayerPayoutFixture = {
    adminId: randomUUID(),
    playerId,
    matchIds: [randomUUID(), randomUUID()],
    registrations: [
      { userId: playerId, registrationId: randomUUID(), gameUid: `uid-${randomUUID()}` },
      { userId: playerId, registrationId: randomUUID(), gameUid: `uid-${randomUUID()}` },
    ],
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, role, wallet_coins)
       VALUES ($1, 'Concurrency Test Admin', $2, 'test-salt', 'test-hash', 'admin', 0)`,
      [fixture.adminId, `admin-${fixture.adminId}@example.test`],
    );
    await client.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Shared Payout Player', $2, 'test-salt', 'test-hash', 100)`,
      [fixture.playerId, `player-${fixture.playerId}@example.test`],
    );

    const prizes: [{ pool: number; distribution: string }, { pool: number; distribution: string }] = [
      { pool: 300, distribution: "1st: 300 coins" },
      { pool: 200, distribution: "2nd: 200 coins" },
    ];
    for (const [index, matchId] of fixture.matchIds.entries()) {
      const prize = prizes[index];
      assert.ok(prize);
      await client.query(
        `INSERT INTO daily007_v2_matches
           (id, title, mode, game_mode, team_type, capacity, prize_pool, prize_distribution, starts_at)
         VALUES ($1, $2, 'solo', 'battle_royale', 'solo', 48, $3, $4, now() - interval '1 hour')`,
        [matchId, `Shared payout tournament ${index + 1}`, prize.pool, prize.distribution],
      );
      const registration = fixture.registrations[index];
      assert.ok(registration);
      await client.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, captain_name, captain_game_name,
            captain_game_uid, team_name, entry_coins_paid, status)
         VALUES ($1, $2, $3, 'Shared Payout Player', $4, $5, '', 0, 'approved')`,
        [
          registration.registrationId,
          matchId,
          fixture.playerId,
          `SharedGame${index + 1}`,
          registration.gameUid,
        ],
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

async function seedExistingPlayerHistory(player: PlayerFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const walletUpdate = await client.query(
      "UPDATE daily007_v2_users SET wallet_coins = 1000 WHERE id = $1",
      [player.userId],
    );
    assert.equal(walletUpdate.rowCount, 1, "the seeded history player must exist");
    await client.query(
      `INSERT INTO daily007_v2_user_stats (user_id, matches, wins, kills, prize_coins)
       VALUES ($1, 5, 1, 42, 500)`,
      [player.userId],
    );
    await client.query(
      `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
       VALUES ($1, 500, 1000, 'match_prize')`,
      [player.userId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setPlayerStats(
  player: PlayerFixture,
  stats: { matches: number; wins: number; kills: number; prize_coins: number },
): Promise<void> {
  await pool.query(
    `INSERT INTO daily007_v2_user_stats (user_id, matches, wins, kills, prize_coins)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       matches = EXCLUDED.matches,
       wins = EXCLUDED.wins,
       kills = EXCLUDED.kills,
       prize_coins = EXCLUDED.prize_coins`,
    [player.userId, stats.matches, stats.wins, stats.kills, stats.prize_coins],
  );
}

async function cleanupFixture(fixture: TournamentFixture): Promise<void> {
  const client = await pool.connect();
  const playerIds = fixture.players.map((player) => player.userId);
  const registrationIds = fixture.players.map((player) => player.registrationId);
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_user_stats WHERE user_id = ANY($1::uuid[])",
      [playerIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_result_awards WHERE registration_id = ANY($1::uuid[])",
      [registrationIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_registrations WHERE id = ANY($1::uuid[])",
      [registrationIds],
    );
    await client.query("DELETE FROM daily007_v2_matches WHERE id = $1", [fixture.matchId]);
    await client.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[fixture.adminId, ...playerIds]],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupSharedPlayerPayoutFixture(fixture: SharedPlayerPayoutFixture): Promise<void> {
  const client = await pool.connect();
  const registrationIds = fixture.registrations.map((registration) => registration.registrationId);
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1",
      [fixture.playerId],
    );
    await client.query(
      "DELETE FROM daily007_v2_user_stats WHERE user_id = $1",
      [fixture.playerId],
    );
    await client.query(
      "DELETE FROM daily007_v2_result_awards WHERE registration_id = ANY($1::uuid[])",
      [registrationIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_registrations WHERE id = ANY($1::uuid[])",
      [registrationIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[fixture.adminId, fixture.playerId]],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function captureSettlementState(fixture: TournamentFixture, player: PlayerFixture) {
  const [wallet, awards, stats, ledger, match] = await Promise.all([
    pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [player.userId],
    ),
    pool.query<{
      registration_id: string;
      user_id: string;
      rank: number;
      kills: number;
      prize_coins: number;
    }>(
      `SELECT registration_id, user_id, rank, kills, prize_coins
         FROM daily007_v2_result_awards
        WHERE match_id = $1
        ORDER BY rank`,
      [fixture.matchId],
    ),
    pool.query<{ matches: number; wins: number; kills: number; prize_coins: number }>(
      `SELECT matches, wins, kills, prize_coins
         FROM daily007_v2_user_stats
        WHERE user_id = $1`,
      [player.userId],
    ),
    pool.query<{ amount: number; balance_after: number; reason: string }>(
      `SELECT amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1
        ORDER BY id`,
      [player.userId],
    ),
    pool.query<{ enabled: boolean; status: string }>(
      "SELECT enabled, status FROM daily007_v2_matches WHERE id = $1",
      [fixture.matchId],
    ),
  ]);

  return {
    walletCoins: wallet.rows[0]?.wallet_coins ?? null,
    awards: awards.rows,
    stats: stats.rows[0] ?? null,
    ledger: ledger.rows,
    match: match.rows[0] ?? null,
  };
}

async function publicStandings(origin: string, matchId: string) {
  const response = await fetch(`${origin}/tournaments/${matchId}/results`);
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

async function installRunnerUpLedgerFailure(userId: string): Promise<void> {
  assert.match(userId, /^[0-9a-f-]{36}$/i);
  await pool.query("CREATE SEQUENCE daily007_test_result_failure_observed_seq");
  await pool.query(`
    CREATE FUNCTION daily007_test_fail_runner_up_ledger() RETURNS trigger
    LANGUAGE plpgsql
    AS $body$
    BEGIN
      IF NEW.user_id::text = TG_ARGV[0] AND NEW.reason = 'match_prize' THEN
        PERFORM nextval('daily007_test_result_failure_observed_seq');
        RAISE EXCEPTION 'Injected failure at runner-up prize ledger insert'
          USING ERRCODE = 'XX000';
      END IF;
      RETURN NEW;
    END;
    $body$
  `);
  await pool.query(`
    CREATE TRIGGER daily007_test_fail_runner_up_ledger
    BEFORE INSERT ON daily007_v2_wallet_ledger
    FOR EACH ROW
    EXECUTE FUNCTION daily007_test_fail_runner_up_ledger('${userId}')
  `);
}

async function removeRunnerUpLedgerFailure(): Promise<void> {
  await pool.query(
    "DROP TRIGGER IF EXISTS daily007_test_fail_runner_up_ledger ON daily007_v2_wallet_ledger",
  );
  await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_runner_up_ledger()");
  await pool.query("DROP SEQUENCE IF EXISTS daily007_test_result_failure_observed_seq");
}

function firstPlaceFailureObjectNames() {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  return {
    trigger: `daily007_test_first_place_failure_${suffix}`,
    function: `daily007_test_first_place_failure_fn_${suffix}`,
    sequence: `daily007_test_first_place_failure_seq_${suffix}`,
  };
}

async function installOneShotFirstPlaceLedgerFailure(
  names: ReturnType<typeof firstPlaceFailureObjectNames>,
  player: PlayerFixture,
  matchId: string,
): Promise<void> {
  await pool.query(`CREATE SEQUENCE ${names.sequence}`);
  await pool.query(`
    CREATE FUNCTION ${names.function}() RETURNS trigger
    LANGUAGE plpgsql
    AS $body$
    BEGIN
      IF NEW.user_id::text = TG_ARGV[0]
         AND NEW.match_id::text = TG_ARGV[1]
         AND NEW.registration_id::text = TG_ARGV[2]
         AND NEW.reason = 'match_prize' THEN
        IF nextval('${names.sequence}') = 1 THEN
          RAISE EXCEPTION 'Injected one-shot failure at first-place prize ledger insert'
            USING ERRCODE = 'XX000';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $body$
  `);
  await pool.query(`
    CREATE TRIGGER ${names.trigger}
    BEFORE INSERT ON daily007_v2_wallet_ledger
    FOR EACH ROW
    EXECUTE FUNCTION ${names.function}('${player.userId}', '${matchId}', '${player.registrationId}')
  `);
}

async function removeOneShotFirstPlaceLedgerFailure(
  names: ReturnType<typeof firstPlaceFailureObjectNames>,
): Promise<void> {
  await pool.query(
    `DROP TRIGGER IF EXISTS ${names.trigger} ON daily007_v2_wallet_ledger`,
  );
  await pool.query(`DROP FUNCTION IF EXISTS ${names.function}()`);
  await pool.query(`DROP SEQUENCE IF EXISTS ${names.sequence}`);
}

async function backendPid(client: { query<T>(sql: string): Promise<{ rows: T[] }> }): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = result.rows[0]?.pid;
  assert.ok(pid, "PostgreSQL must provide a backend id for the lock holder.");
  return Number(pid);
}

async function waitForBlockedResultRequests(
  blockerPid: number,
  expectedCount: number,
  timeoutMs = 5_000,
): Promise<Array<{ pid: number; blockers: number[] }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query LIKE '%FROM daily007_v2_matches%'
          AND activity.query LIKE '%FOR UPDATE%'
        ORDER BY activity.query_start`,
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(
        result.rows.length,
        expectedCount,
        `Only the ${expectedCount} competing result requests should be blocked.`,
      );
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.includes(blockerPid)),
        "At least one request must be waiting directly on the test's tournament-row lock.",
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => pid === blockerPid || requestPids.has(pid)),
        ),
        "Every blocked request must be waiting behind the test lock or another queued result request.",
      );
      return result.rows.map((row) => ({
        pid: Number(row.pid),
        blockers: row.blockers.map(Number),
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} result requests to block in PostgreSQL.`);
}

async function waitForBlockedWalletPayoutRequests(
  blockerPid: number,
  expectedCount: number,
  timeoutMs = 5_000,
): Promise<Array<{ pid: number; blockers: number[] }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query LIKE $1
        ORDER BY activity.query_start`,
      ["%SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE%"],
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(
        result.rows.length,
        expectedCount,
        `Only the ${expectedCount} shared-wallet payout requests should be blocked.`,
      );
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.includes(blockerPid)),
        "At least one payout request must be waiting directly on the test's wallet-row lock.",
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => pid === blockerPid || requestPids.has(pid)),
        ),
        "Every payout request must be queued behind the wallet lock or another payout request.",
      );
      return result.rows.map((row) => ({
        pid: Number(row.pid),
        blockers: row.blockers.map(Number),
      }));
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} shared-wallet payout requests in PostgreSQL.`);
}

test("concurrent first-place submissions serialize on the real tournament row lock", async () => {
  const fixture = await createFixture();
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let submissions: Promise<ResultResponse>[] = [];

  try {
    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [fixture.matchId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = [
        submitResult(origin, fixture.adminId, fixture.matchId, fixture.players[0], 1, 4),
        submitResult(origin, fixture.adminId, fixture.matchId, fixture.players[1], 1, 9),
      ];

      try {
        const waitingRequests = await waitForBlockedResultRequests(blockerPid, 2);
        assert.equal(waitingRequests.length, 2);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);

      const winningIndex = results.findIndex((result) => result.status === 201);
      const losingIndex = results.findIndex((result) => result.status === 409);
      assert.notEqual(winningIndex, -1);
      assert.notEqual(losingIndex, -1);
      assert.equal(
        results[losingIndex].body.error,
        "A winner has already been declared for this tournament.",
      );

      const winningPlayer = fixture.players[winningIndex];
      const winningResult = results[winningIndex];
      assert.equal(winningResult.body.registrationId, winningPlayer.registrationId);
      assert.equal(winningResult.body.userId, winningPlayer.userId);
      assert.equal(winningResult.body.prizeCoins, 500);
      assert.equal(winningResult.body.walletCoins, 600);

      const awards = await pool.query<{
        registration_id: string;
        user_id: string;
        rank: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT registration_id, user_id, rank, kills, prize_coins
           FROM daily007_v2_result_awards
          WHERE match_id = $1`,
        [fixture.matchId],
      );
      assert.deepEqual(awards.rows, [{
        registration_id: winningPlayer.registrationId,
        user_id: winningPlayer.userId,
        rank: 1,
        kills: winningIndex === 0 ? 4 : 9,
        prize_coins: 500,
      }], "exactly one first-place award must be stored");

      const rejectedAward = await pool.query(
        "SELECT registration_id FROM daily007_v2_result_awards WHERE registration_id = $1",
        [fixture.players[losingIndex].registrationId],
      );
      assert.deepEqual(rejectedAward.rows, [], "the rejected player's result must not be saved");

      const standings = await publicStandings(origin, fixture.matchId);
      assert.equal(standings.status, 200);
      assert.equal(standings.body.status, "finalized");
      assert.deepEqual(standings.body.entries, [{
        rank: 1,
        kills: winningIndex === 0 ? 4 : 9,
        prizeCoins: 500,
        gameName: `TestGame${winningIndex + 1}`,
        teamName: null,
      }], "public standings must expose only the accepted winner");

      const wallets = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [fixture.players.map((player) => player.userId)],
      );
      const expectedWallets = fixture.players.map((player, index) => ({
        id: player.userId,
        wallet_coins: index === winningIndex ? 600 : 100,
      })).sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(wallets.rows, expectedWallets, "only the winning player's wallet should receive the prize");

      const ledger = await pool.query<{
        user_id: string;
        match_id: string;
        registration_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [fixture.players.map((player) => player.userId)],
      );
      assert.deepEqual(ledger.rows, [{
        user_id: winningPlayer.userId,
        match_id: fixture.matchId,
        registration_id: winningPlayer.registrationId,
        amount: 500,
        balance_after: 600,
        reason: "match_prize",
      }], "only one prize ledger entry should be written");

      const stats = await pool.query<{
        user_id: string;
        matches: number;
        wins: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT user_id, matches, wins, kills, prize_coins
           FROM daily007_v2_user_stats
          WHERE user_id = ANY($1::uuid[])`,
        [fixture.players.map((player) => player.userId)],
      );
      assert.deepEqual(stats.rows, [{
        user_id: winningPlayer.userId,
        matches: 1,
        wins: 1,
        kills: winningIndex === 0 ? 4 : 9,
        prize_coins: 500,
      }], "only the winning player should receive result statistics");

      const match = await pool.query<{ enabled: boolean }>(
        "SELECT enabled FROM daily007_v2_matches WHERE id = $1",
        [fixture.matchId],
      );
      assert.deepEqual(match.rows, [{ enabled: false }]);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("concurrent submissions for the same non-winning rank pay only one player", async () => {
  const fixture = await createFixture();
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let submissions: Promise<ResultResponse>[] = [];

  try {
    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [fixture.matchId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = [
        submitResult(origin, fixture.adminId, fixture.matchId, fixture.players[0], 2, 4),
        submitResult(origin, fixture.adminId, fixture.matchId, fixture.players[1], 2, 9),
      ];

      try {
        const waitingRequests = await waitForBlockedResultRequests(blockerPid, 2);
        assert.equal(waitingRequests.length, 2);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(
        results.map((result) => result.status).sort(),
        [201, 409],
        `exactly one player may receive this placement: ${JSON.stringify(results)}`,
      );
      const winningIndex = results.findIndex((result) => result.status === 201);
      const rejectedIndex = results.findIndex((result) => result.status === 409);
      assert.notEqual(winningIndex, -1);
      assert.notEqual(rejectedIndex, -1);

      const successful = results[winningIndex];
      const rejected = results[rejectedIndex];
      const winningPlayer = fixture.players[winningIndex];
      const rejectedPlayer = fixture.players[rejectedIndex];
      assert.ok(successful);
      assert.ok(rejected);
      assert.ok(winningPlayer);
      assert.ok(rejectedPlayer);
      assert.equal(
        rejected.body.error,
        "This placement has already been awarded for this tournament.",
      );
      assert.equal(successful.body.registrationId, winningPlayer.registrationId);
      assert.equal(successful.body.userId, winningPlayer.userId);
      assert.equal(successful.body.prizeCoins, 250);
      assert.equal(successful.body.walletCoins, 350);

      const awards = await pool.query<{
        registration_id: string;
        user_id: string;
        rank: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT registration_id, user_id, rank, kills, prize_coins
           FROM daily007_v2_result_awards
          WHERE match_id = $1 AND rank = 2`,
        [fixture.matchId],
      );
      assert.deepEqual(awards.rows, [{
        registration_id: winningPlayer.registrationId,
        user_id: winningPlayer.userId,
        rank: 2,
        kills: winningIndex === 0 ? 4 : 9,
        prize_coins: 250,
      }], "exactly one rank-two award must be saved");

      const rejectedAward = await pool.query(
        "SELECT registration_id FROM daily007_v2_result_awards WHERE registration_id = $1",
        [rejectedPlayer.registrationId],
      );
      assert.deepEqual(rejectedAward.rows, [], "the rejected player must receive no award");

      const winningState = await captureSettlementState(fixture, winningPlayer);
      assert.deepEqual(winningState, {
        walletCoins: 350,
        awards: [{
          registration_id: winningPlayer.registrationId,
          user_id: winningPlayer.userId,
          rank: 2,
          kills: winningIndex === 0 ? 4 : 9,
          prize_coins: 250,
        }],
        stats: {
          matches: 1,
          wins: 0,
          kills: winningIndex === 0 ? 4 : 9,
          prize_coins: 250,
        },
        ledger: [{
          amount: 250,
          balance_after: 350,
          reason: "match_prize",
        }],
        match: { enabled: true, status: "open" },
      });

      const rejectedState = await captureSettlementState(fixture, rejectedPlayer);
      assert.equal(rejectedState.walletCoins, 100, "the rejected player's wallet must not change");
      assert.equal(rejectedState.stats, null, "the rejected player must receive no stats update");
      assert.deepEqual(rejectedState.ledger, [], "the rejected player must have no prize ledger row");
      assert.deepEqual(rejectedState.match, { enabled: true, status: "open" });
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("an independent tournament result completes while another match row is locked", async () => {
  const lockedFixture = await createFixture();
  let independentFixture: TournamentFixture | undefined;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  const submissions: Promise<ResultResponse>[] = [];

  try {
    independentFixture = await createFixture();
    const independentPrizeUpdate = await pool.query(
      `UPDATE daily007_v2_matches
          SET prize_pool = 960,
              prize_distribution = '1st: 600 coins\n2nd: 240 coins\n3rd: 120 coins'
        WHERE id = $1`,
      [independentFixture.matchId],
    );
    assert.equal(independentPrizeUpdate.rowCount, 1);
    blocker = await pool.connect();

    const [lockedWinner, lockedOtherPlayer] = lockedFixture.players;
    const [independentWinner, independentOtherPlayer] = independentFixture.players;
    assert.ok(lockedWinner && lockedOtherPlayer && independentWinner && independentOtherPlayer);

    await withServer(async (origin) => {
      await blocker!.query("BEGIN");
      blockerTransactionOpen = true;

      try {
        await blocker!.query(
          "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
          [lockedFixture.matchId],
        );
        const blockerPid = await backendPid(blocker!);
        const lockedSubmission = submitResult(
          origin,
          lockedFixture.adminId,
          lockedFixture.matchId,
          lockedWinner,
          1,
          8,
        );
        submissions.push(lockedSubmission);
        await waitForBlockedResultRequests(blockerPid, 1);

        const independentSubmission = submitResult(
          origin,
          independentFixture!.adminId,
          independentFixture!.matchId,
          independentWinner,
          1,
          4,
        );
        submissions.push(independentSubmission);

        let completionTimeout: ReturnType<typeof setTimeout> | undefined;
        const independentResult = await Promise.race([
          independentSubmission,
          new Promise<null>((resolve) => {
            completionTimeout = setTimeout(() => resolve(null), 5_000);
          }),
        ]).finally(() => {
          if (completionTimeout) clearTimeout(completionTimeout);
        });
        assert.ok(
          independentResult,
          "the independent tournament result must complete while the first match remains locked",
        );
        assert.equal(
          blockerTransactionOpen,
          true,
          "the independent result must finish before the blocked match lock is released",
        );
        assert.equal(independentResult.status, 201);
        assert.equal(independentResult.body.registrationId, independentWinner.registrationId);
        assert.equal(independentResult.body.userId, independentWinner.userId);
        assert.equal(independentResult.body.prizeCoins, 600);
        assert.equal(independentResult.body.walletCoins, 700);

        assert.deepEqual(await captureSettlementState(independentFixture!, independentWinner), {
          walletCoins: 700,
          awards: [{
            registration_id: independentWinner.registrationId,
            user_id: independentWinner.userId,
            rank: 1,
            kills: 4,
            prize_coins: 600,
          }],
          stats: { matches: 1, wins: 1, kills: 4, prize_coins: 600 },
          ledger: [{ amount: 600, balance_after: 700, reason: "match_prize" }],
          match: { enabled: false, status: "open" },
        });

        await blocker!.query("COMMIT");
        blockerTransactionOpen = false;
        const lockedResult = await lockedSubmission;
        assert.equal(lockedResult.status, 201);
        assert.equal(lockedResult.body.registrationId, lockedWinner.registrationId);
        assert.equal(lockedResult.body.userId, lockedWinner.userId);
        assert.equal(lockedResult.body.prizeCoins, 500);
        assert.equal(lockedResult.body.walletCoins, 600);

        const [lockedStandings, independentStandings] = await Promise.all([
          publicStandings(origin, lockedFixture.matchId),
          publicStandings(origin, independentFixture!.matchId),
        ]);
        assert.equal(lockedStandings.status, 200);
        assert.deepEqual(lockedStandings.body.entries, [{
          rank: 1,
          kills: 8,
          prizeCoins: 500,
          gameName: "TestGame1",
          teamName: null,
        }]);
        assert.equal(lockedStandings.body.status, "finalized");
        assert.equal(independentStandings.status, 200);
        assert.deepEqual(independentStandings.body.entries, [{
          rank: 1,
          kills: 4,
          prizeCoins: 600,
          gameName: "TestGame1",
          teamName: null,
        }]);
        assert.equal(independentStandings.body.status, "finalized");

        assert.deepEqual(await captureSettlementState(lockedFixture, lockedWinner), {
          walletCoins: 600,
          awards: [{
            registration_id: lockedWinner.registrationId,
            user_id: lockedWinner.userId,
            rank: 1,
            kills: 8,
            prize_coins: 500,
          }],
          stats: { matches: 1, wins: 1, kills: 8, prize_coins: 500 },
          ledger: [{ amount: 500, balance_after: 600, reason: "match_prize" }],
          match: { enabled: false, status: "open" },
        });
        assert.deepEqual(await captureSettlementState(lockedFixture, lockedOtherPlayer), {
          walletCoins: 100,
          awards: [{
            registration_id: lockedWinner.registrationId,
            user_id: lockedWinner.userId,
            rank: 1,
            kills: 8,
            prize_coins: 500,
          }],
          stats: null,
          ledger: [],
          match: { enabled: false, status: "open" },
        });
        assert.deepEqual(await captureSettlementState(independentFixture!, independentWinner), {
          walletCoins: 700,
          awards: [{
            registration_id: independentWinner.registrationId,
            user_id: independentWinner.userId,
            rank: 1,
            kills: 4,
            prize_coins: 600,
          }],
          stats: { matches: 1, wins: 1, kills: 4, prize_coins: 600 },
          ledger: [{ amount: 600, balance_after: 700, reason: "match_prize" }],
          match: { enabled: false, status: "open" },
        });
        assert.deepEqual(await captureSettlementState(independentFixture!, independentOtherPlayer), {
          walletCoins: 100,
          awards: [{
            registration_id: independentWinner.registrationId,
            user_id: independentWinner.userId,
            rank: 1,
            kills: 4,
            prize_coins: 600,
          }],
          stats: null,
          ledger: [],
          match: { enabled: false, status: "open" },
        });
      } finally {
        if (blockerTransactionOpen) {
          await blocker!.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }
    });
  } finally {
    if (blocker) {
      if (blockerTransactionOpen) await blocker.query("ROLLBACK");
      blocker.release();
    }
    await Promise.allSettled(submissions);
    await cleanupFixture(lockedFixture);
    if (independentFixture) await cleanupFixture(independentFixture);
  }
});

test("concurrent retries for the same registration publish and pay exactly once", async () => {
  const fixture = await createFixture();
  const player = fixture.players[0];
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let submissions: Promise<ResultResponse>[] = [];

  try {
    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [fixture.matchId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = [
        submitResult(origin, fixture.adminId, fixture.matchId, player, 1, 4),
        submitResult(origin, fixture.adminId, fixture.matchId, player, 1, 4),
      ];

      try {
        const waitingRequests = await waitForBlockedResultRequests(blockerPid, 2);
        assert.equal(waitingRequests.length, 2);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);

      const successful = results.find((result) => result.status === 201);
      const rejected = results.find((result) => result.status === 409);
      assert.ok(successful, "one result request must succeed");
      assert.ok(rejected, "the duplicate result request must be rejected");
      assert.equal(
        rejected.body.error,
        "A result has already been published for this registration.",
      );
      assert.equal(successful.body.registrationId, player.registrationId);
      assert.equal(successful.body.userId, player.userId);
      assert.equal(successful.body.prizeCoins, 500);
      assert.equal(successful.body.walletCoins, 600);

      const awards = await pool.query<{
        registration_id: string;
        user_id: string;
        rank: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT registration_id, user_id, rank, kills, prize_coins
           FROM daily007_v2_result_awards
          WHERE registration_id = $1`,
        [player.registrationId],
      );
      assert.deepEqual(awards.rows, [{
        registration_id: player.registrationId,
        user_id: player.userId,
        rank: 1,
        kills: 4,
        prize_coins: 500,
      }], "the registration must have exactly one award");

      const wallets = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [fixture.players.map((entry) => entry.userId)],
      );
      const expectedWallets = fixture.players.map((entry, index) => ({
        id: entry.userId,
        wallet_coins: index === 0 ? 600 : 100,
      })).sort((left, right) => left.id.localeCompare(right.id));
      assert.deepEqual(wallets.rows, expectedWallets, "the prize must be credited once");

      const ledger = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [fixture.players.map((entry) => entry.userId)],
      );
      assert.deepEqual(ledger.rows, [{
        user_id: player.userId,
        amount: 500,
        balance_after: 600,
        reason: "match_prize",
      }], "only one prize ledger entry must be written");

      const stats = await pool.query<{
        user_id: string;
        matches: number;
        wins: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT user_id, matches, wins, kills, prize_coins
           FROM daily007_v2_user_stats
          WHERE user_id = ANY($1::uuid[])`,
        [fixture.players.map((entry) => entry.userId)],
      );
      assert.deepEqual(stats.rows, [{
        user_id: player.userId,
        matches: 1,
        wins: 1,
        kills: 4,
        prize_coins: 500,
      }], "result statistics must be applied once");

      const match = await pool.query<{ enabled: boolean }>(
        "SELECT enabled FROM daily007_v2_matches WHERE id = $1",
        [fixture.matchId],
      );
      assert.deepEqual(match.rows, [{ enabled: false }]);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("an unrelated unique conflict while writing the prize ledger is not reported as a duplicate result", async () => {
  const fixture = await createFixture();
  const conflictPlayer = fixture.players[1];
  const seedPlayer = fixture.players[0];
  const testConstraint = "daily007_test_wallet_ledger_amount_unique";

  try {
    await pool.query(
      `CREATE UNIQUE INDEX ${testConstraint}
         ON daily007_v2_wallet_ledger (amount)`,
    );
    await pool.query("CREATE SEQUENCE daily007_test_wallet_ledger_insert_attempts");
    await pool.query(
      `CREATE FUNCTION daily007_test_count_wallet_ledger_insert() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         PERFORM nextval('daily007_test_wallet_ledger_insert_attempts');
         RETURN NEW;
       END;
       $$`,
    );
    await pool.query(
      `CREATE TRIGGER daily007_test_wallet_ledger_insert_attempt
       BEFORE INSERT ON daily007_v2_wallet_ledger
       FOR EACH ROW EXECUTE FUNCTION daily007_test_count_wallet_ledger_insert()`,
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger (user_id, amount, balance_after, reason)
       VALUES ($1, 250, 350, 'test_unique_conflict_seed')`,
      [seedPlayer.userId],
    );

    await withServer(async (origin) => {
      const response = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        conflictPlayer,
        2,
        8,
      );
      assert.equal(response.status, 500);
      assert.equal(response.body.error, "Test server encountered an unexpected error.");
      assert.notEqual(
        response.body.error,
        "A result has already been published for this registration.",
      );

      const insertAttempts = await pool.query<{ last_value: string; is_called: boolean }>(
        `SELECT last_value::text AS last_value, is_called
           FROM daily007_test_wallet_ledger_insert_attempts`,
      );
      assert.deepEqual(
        insertAttempts.rows,
        [{ last_value: "2", is_called: true }],
        "the failed transaction must have reached its prize-ledger insert",
      );

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [conflictPlayer.userId],
      );
      assert.deepEqual(wallet.rows, [{ wallet_coins: 100 }], "the wallet update must roll back");

      const awards = await pool.query(
        "SELECT registration_id FROM daily007_v2_result_awards WHERE registration_id = $1",
        [conflictPlayer.registrationId],
      );
      assert.deepEqual(awards.rows, [], "the result award must roll back");

      const stats = await pool.query(
        "SELECT user_id FROM daily007_v2_user_stats WHERE user_id = $1",
        [conflictPlayer.userId],
      );
      assert.deepEqual(stats.rows, [], "the statistics update must roll back");

      const ledger = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE amount = 250
          ORDER BY user_id`,
      );
      assert.deepEqual(ledger.rows, [{
        user_id: seedPlayer.userId,
        amount: 250,
        balance_after: 350,
        reason: "test_unique_conflict_seed",
      }], "the injected unique conflict must leave only the seed ledger row");
    });
  } finally {
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_wallet_ledger_insert_attempt ON daily007_v2_wallet_ledger",
    );
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_count_wallet_ledger_insert()");
    await pool.query("DROP SEQUENCE IF EXISTS daily007_test_wallet_ledger_insert_attempts");
    await pool.query(`DROP INDEX IF EXISTS ${testConstraint}`);
    await cleanupFixture(fixture);
  }
});

test("a prize that exceeds the player's wallet limit leaves tournament settlement state unchanged", async () => {
  const fixture = await createFixture();
  const player = fixture.players[0];
  const startingBalance = MAX_SUPPORTED_DATABASE_INT - 100;
  const prizeCoins = 500;

  try {
    await seedExistingPlayerHistory(player);
    await pool.query(
      "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
      [player.userId, startingBalance],
    );
    await pool.query(
      `UPDATE daily007_v2_matches
          SET prize_pool = $2,
              prize_distribution = '1st: 500 coins'
        WHERE id = $1`,
      [fixture.matchId, prizeCoins],
    );

    const before = await captureSettlementState(fixture, player);
    assert.equal(before.walletCoins, startingBalance);
    assert.deepEqual(before.awards, []);
    assert.deepEqual(before.stats, {
      matches: 5,
      wins: 1,
      kills: 42,
      prize_coins: 500,
    });
    assert.deepEqual(before.ledger, [{
      amount: 500,
      balance_after: 1000,
      reason: "match_prize",
    }]);

    await withServer(async (origin) => {
      const response = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        player,
        1,
        7,
      );

      assert.equal(response.status, 409);
      assert.equal(response.body.error, "Prize would exceed the supported wallet range.");
      assert.equal(startingBalance + prizeCoins > MAX_SUPPORTED_DATABASE_INT, true);
    });

    const after = await captureSettlementState(fixture, player);
    assert.deepEqual(
      after,
      before,
      "a rejected oversized prize must not alter the wallet, award, stats, ledger, or match state",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("lifetime-stat increments that exceed the database integer limit leave settlement unchanged", async () => {
  const fixture = await createFixture(4);
  const distribution = "1st: 500 coins\n2nd: 250 coins\n3rd: 125 coins\n4th: 125 coins";

  try {
    await pool.query(
      `UPDATE daily007_v2_matches
          SET prize_pool = 1000, prize_distribution = $2
        WHERE id = $1`,
      [fixture.matchId, distribution],
    );

    const cases = [
      {
        statName: "matches",
        player: fixture.players[0],
        rank: 2,
        kills: 0,
        stats: { matches: MAX_SUPPORTED_DATABASE_INT, wins: 0, kills: 0, prize_coins: 0 },
      },
      {
        statName: "wins",
        player: fixture.players[1],
        rank: 1,
        kills: 0,
        stats: { matches: 0, wins: MAX_SUPPORTED_DATABASE_INT, kills: 0, prize_coins: 0 },
      },
      {
        statName: "kills",
        player: fixture.players[2],
        rank: 3,
        kills: 1,
        stats: { matches: 0, wins: 0, kills: MAX_SUPPORTED_DATABASE_INT, prize_coins: 0 },
      },
      {
        statName: "prize total",
        player: fixture.players[3],
        rank: 4,
        kills: 0,
        stats: { matches: 0, wins: 0, kills: 0, prize_coins: MAX_SUPPORTED_DATABASE_INT },
      },
    ] as const;

    await withServer(async (origin) => {
      for (const { statName, player, rank, kills, stats } of cases) {
        assert.ok(player, `a player fixture is required for the ${statName} overflow case`);
        await setPlayerStats(player, stats);
        const before = await captureSettlementState(fixture, player);
        const response = await submitResult(origin, fixture.adminId, fixture.matchId, player, rank, kills);

        assert.equal(response.status, 409, `overflowing ${statName} must be rejected: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.error, `Player lifetime ${statName} would exceed the supported range.`);
        assert.deepEqual(
          await captureSettlementState(fixture, player),
          before,
          `rejecting an overflowing ${statName} must preserve the award, wallet, stats, ledger, and match state`,
        );
      }
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("lifetime-stat increments that reach the database integer limit are accepted", async () => {
  const fixture = await createFixture(4);
  const distribution = "1st: 500 coins\n2nd: 250 coins\n3rd: 125 coins\n4th: 125 coins";

  try {
    await pool.query(
      `UPDATE daily007_v2_matches
          SET prize_pool = 1000, prize_distribution = $2
        WHERE id = $1`,
      [fixture.matchId, distribution],
    );

    const cases = [
      {
        statName: "matches",
        player: fixture.players[0],
        rank: 2,
        kills: 0,
        prizeCoins: 250,
        stats: { matches: MAX_SUPPORTED_DATABASE_INT - 1, wins: 0, kills: 0, prize_coins: 0 },
      },
      {
        statName: "wins",
        player: fixture.players[1],
        rank: 1,
        kills: 0,
        prizeCoins: 500,
        stats: { matches: 0, wins: MAX_SUPPORTED_DATABASE_INT - 1, kills: 0, prize_coins: 0 },
      },
      {
        statName: "kills",
        player: fixture.players[2],
        rank: 3,
        kills: 17,
        prizeCoins: 125,
        stats: { matches: 0, wins: 0, kills: MAX_SUPPORTED_DATABASE_INT - 17, prize_coins: 0 },
      },
      {
        statName: "prize total",
        player: fixture.players[3],
        rank: 4,
        kills: 0,
        prizeCoins: 125,
        stats: { matches: 0, wins: 0, kills: 0, prize_coins: MAX_SUPPORTED_DATABASE_INT - 125 },
      },
    ] as const;

    await withServer(async (origin) => {
      for (const { statName, player, rank, kills, prizeCoins, stats } of cases) {
        assert.ok(player, `a player fixture is required for the ${statName} boundary case`);
        await setPlayerStats(player, stats);
        const response = await submitResult(origin, fixture.adminId, fixture.matchId, player, rank, kills);
        assert.equal(response.status, 201, `reaching the ${statName} limit must succeed: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.prizeCoins, prizeCoins);
        const finalState = await captureSettlementState(fixture, player);
        assert.deepEqual(finalState.stats, {
          matches: stats.matches + 1,
          wins: stats.wins + (rank === 1 ? 1 : 0),
          kills: stats.kills + kills,
          prize_coins: stats.prize_coins + prizeCoins,
        });
        assert.equal(
          finalState.stats?.[statName === "prize total" ? "prize_coins" : statName],
          MAX_SUPPORTED_DATABASE_INT,
          `the ${statName} counter should reach the supported maximum`,
        );
      }
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("concurrent runner-up retries for the same registration award and pay exactly once", async () => {
  const fixture = await createFixture();
  const runnerUp = fixture.players[1];
  const otherPlayer = fixture.players[0];
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let submissions: Promise<ResultResponse>[] = [];

  try {
    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [fixture.matchId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = [
        submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 6),
        submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 9),
      ];

      try {
        const waitingRequests = await waitForBlockedResultRequests(blockerPid, 2);
        assert.equal(waitingRequests.length, 2);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);

      const successful = results.find((result) => result.status === 201);
      const rejected = results.find((result) => result.status === 409);
      assert.ok(successful, "one runner-up result request must succeed");
      assert.ok(rejected, "the concurrent runner-up retry must be rejected");
      assert.equal(
        rejected.body.error,
        "A result has already been published for this registration.",
      );
      assert.equal(successful.body.registrationId, runnerUp.registrationId);
      assert.equal(successful.body.userId, runnerUp.userId);
      assert.equal(successful.body.prizeCoins, 250);
      assert.equal(successful.body.walletCoins, 350);
      const successfulKills = results[0].status === 201 ? 6 : 9;

      const runnerUpState = await captureSettlementState(fixture, runnerUp);
      assert.deepEqual(runnerUpState, {
        walletCoins: 350,
        awards: [{
          registration_id: runnerUp.registrationId,
          user_id: runnerUp.userId,
          rank: 2,
          kills: successfulKills,
          prize_coins: 250,
        }],
        stats: {
          matches: 1,
          wins: 0,
          kills: successfulKills,
          prize_coins: 250,
        },
        ledger: [{
          amount: 250,
          balance_after: 350,
          reason: "match_prize",
        }],
        match: {
          enabled: true,
          status: "open",
        },
      });

      const otherPlayerState = await captureSettlementState(fixture, otherPlayer);
      assert.equal(otherPlayerState.walletCoins, 100);
      assert.equal(otherPlayerState.stats, null);
      assert.deepEqual(otherPlayerState.ledger, []);
      assert.equal(otherPlayerState.awards.length, 1);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("saved runner-up results are discoverable before a winner and retries do not pay twice", async () => {
  const fixture = await createFixture();
  const runnerUp = fixture.players[1];

  try {
    await withServer(async (origin) => {
      const published = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(published.status, 201, `runner-up result should save: ${JSON.stringify(published.body)}`);
      assert.equal(published.body.registrationId, runnerUp.registrationId);
      assert.equal(published.body.prizeCoins, 250);
      assert.equal(published.body.walletCoins, 350);

      const stateAfterPublish = await captureSettlementState(fixture, runnerUp);
      assert.deepEqual(stateAfterPublish, {
        walletCoins: 350,
        awards: [{
          registration_id: runnerUp.registrationId,
          user_id: runnerUp.userId,
          rank: 2,
          kills: 3,
          prize_coins: 250,
        }],
        stats: { matches: 1, wins: 0, kills: 3, prize_coins: 250 },
        ledger: [{ amount: 250, balance_after: 350, reason: "match_prize" }],
        match: { enabled: true, status: "open" },
      }, "the placement should be saved without declaring a winner or completing the match");

      const defaultResponse = await fetch(`${origin}/admin/results`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(defaultResponse.status, 200);
      const defaultBody = await defaultResponse.json() as {
        data: Array<Record<string, unknown>>;
      };
      assert.equal(
        defaultBody.data.some((entry) => entry.tournamentId === fixture.matchId),
        false,
        "unfinalized placements should remain hidden from the default completed-results list",
      );

      const recoveryResponse = await fetch(`${origin}/admin/results?includeUnfinalized=true`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(recoveryResponse.status, 200);
      const recoveryBody = await recoveryResponse.json() as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      assert.equal(recoveryBody.success, true);
      const recovered = recoveryBody.data.find(
        (entry) =>
          entry.tournamentId === fixture.matchId &&
          entry.registrationId === runnerUp.registrationId,
      );
      assert.ok(recovered, "the committed placement must be discoverable for response-loss recovery");
      assert.deepEqual({
        tournamentId: recovered.tournamentId,
        registrationId: recovered.registrationId,
        rank: recovered.rank,
        prizeCoins: recovered.prizeCoins,
      }, {
        tournamentId: fixture.matchId,
        registrationId: runnerUp.registrationId,
        rank: 2,
        prizeCoins: 250,
      });

      const retry = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(retry.status, 409);
      assert.equal(retry.body.error, "A result has already been published for this registration.");
      assert.deepEqual(
        await captureSettlementState(fixture, runnerUp),
        stateAfterPublish,
        "retrying must not change the player's wallet, ledger, award, stats, or tournament state",
      );
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("Admin result recovery excludes a saved placement after its tournament is cancelled", async () => {
  const fixture = await createFixture();
  const runnerUp = fixture.players[1];

  try {
    await withServer(async (origin) => {
      const published = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        runnerUp,
        2,
        3,
      );
      assert.equal(
        published.status,
        201,
        `the placement must be saved before cancellation: ${JSON.stringify(published.body)}`,
      );

      const cancelled = await pool.query<{ id: string; status: string; enabled: boolean }>(
        `UPDATE daily007_v2_matches
            SET status = 'cancelled', enabled = false
          WHERE id = $1
          RETURNING id, status, enabled`,
        [fixture.matchId],
      );
      assert.deepEqual(cancelled.rows, [{
        id: fixture.matchId,
        status: "cancelled",
        enabled: false,
      }]);

      const savedAward = await pool.query<{
        match_id: string;
        registration_id: string;
        rank: number;
      }>(
        `SELECT match_id, registration_id, rank
           FROM daily007_v2_result_awards
          WHERE match_id = $1`,
        [fixture.matchId],
      );
      assert.deepEqual(savedAward.rows, [{
        match_id: fixture.matchId,
        registration_id: runnerUp.registrationId,
        rank: 2,
      }], "cancellation must not erase the already-saved placement");

      const recoveryResponse = await fetch(`${origin}/admin/results?includeUnfinalized=true`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(recoveryResponse.status, 200);
      const recoveryBody = await recoveryResponse.json() as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      assert.equal(recoveryBody.success, true);
      assert.equal(
        recoveryBody.data.some(
          (entry) =>
            entry.tournamentId === fixture.matchId &&
            entry.registrationId === runnerUp.registrationId,
        ),
        false,
        "a cancelled tournament's saved award must not appear in Admin recovery results",
      );
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("result submissions for a cancelled tournament leave settlement data unchanged", async () => {
  const fixture = await createFixture();
  const approvedPlayer = fixture.players[0];

  try {
    const cancelled = await pool.query<{ status: string; enabled: boolean }>(
      `UPDATE daily007_v2_matches
          SET status = 'cancelled', enabled = false
        WHERE id = $1
        RETURNING status, enabled`,
      [fixture.matchId],
    );
    assert.deepEqual(cancelled.rows, [{ status: "cancelled", enabled: false }]);

    await withServer(async (origin) => {
      const before = await captureSettlementState(fixture, approvedPlayer);
      assert.deepEqual(before.match, { enabled: false, status: "cancelled" });

      const result = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        approvedPlayer,
        1,
        7,
      );

      assert.equal(result.status, 409);
      assert.equal(result.body.error, "Results cannot be published for a cancelled tournament.");
      assert.deepEqual(
        await captureSettlementState(fixture, approvedPlayer),
        before,
        "the rejected request must not create an award, change the wallet or stats, or write a ledger credit",
      );
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("duplicate-placement audit reports complete historical groups without changing settlement data", async () => {
  const fixture = await createFixture(3);

  try {
    await pool.query(
      `INSERT INTO daily007_v2_result_awards
         (match_id, registration_id, user_id, rank, kills, prize_coins)
       VALUES ($1, $2, $3, 2, 7, 500),
              ($1, $4, $5, 2, 5, 250),
              ($1, $6, $7, 3, 2, 100)`,
      [
        fixture.matchId,
        fixture.players[0].registrationId,
        fixture.players[0].userId,
        fixture.players[1].registrationId,
        fixture.players[1].userId,
        fixture.players[2].registrationId,
        fixture.players[2].userId,
      ],
    );
    await pool.query(
      "UPDATE daily007_v2_matches SET status = 'cancelled', enabled = false WHERE id = $1",
      [fixture.matchId],
    );

    const captureStoredState = async () => {
      const [awards, users, stats, ledger] = await Promise.all([
        pool.query(
          `SELECT id, match_id, registration_id, user_id, rank, kills, prize_coins
             FROM daily007_v2_result_awards
            WHERE match_id = $1
            ORDER BY registration_id`,
          [fixture.matchId],
        ),
        pool.query(
          `SELECT id, wallet_coins
             FROM daily007_v2_users
            WHERE id = ANY($1::uuid[])
            ORDER BY id`,
          [fixture.players.map((player) => player.userId)],
        ),
        pool.query(
          `SELECT user_id, matches, wins, kills, prize_coins
             FROM daily007_v2_user_stats
            WHERE user_id = ANY($1::uuid[])
            ORDER BY user_id`,
          [fixture.players.map((player) => player.userId)],
        ),
        pool.query(
          `SELECT user_id, amount, balance_after, reason, match_id, registration_id
             FROM daily007_v2_wallet_ledger
            WHERE match_id = $1
            ORDER BY registration_id`,
          [fixture.matchId],
        ),
      ]);
      return { awards: awards.rows, users: users.rows, stats: stats.rows, ledger: ledger.rows };
    };
    const before = await captureStoredState();

    await withServer(async (origin) => {
      const response = await fetch(`${origin}/admin/results/duplicate-placements`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as {
        success: boolean;
        data: Array<{
          tournamentId: string;
          tournamentName: string;
          startsAt: string;
          tournamentStatus: string;
          prizePool: number;
          prizeDistribution: string;
          rank: number;
          registrationCount: number;
          totalPrizeCoins: string;
          awards: Array<{
            awardId: string;
            registrationId: string;
            userId: string;
            playerName: string;
            gameName: string;
            kills: number;
            prizeCoins: number;
            createdAt: string;
          }>;
        }>;
        correctionGuidance: string;
      };

      assert.equal(body.success, true);
      assert.equal(body.data.length, 1, "only duplicate tournament/rank groups should be reported");
      const [group] = body.data;
      assert.ok(group);
      assert.deepEqual({
        tournamentId: group.tournamentId,
        tournamentName: group.tournamentName,
        tournamentStatus: group.tournamentStatus,
        rank: group.rank,
        registrationCount: group.registrationCount,
        totalPrizeCoins: group.totalPrizeCoins,
      }, {
        tournamentId: fixture.matchId,
        tournamentName: "Isolated result race",
        tournamentStatus: "cancelled",
        rank: 2,
        registrationCount: 2,
        totalPrizeCoins: "750",
      });
      assert.ok(Number.isFinite(Date.parse(group.startsAt)));
      assert.equal(group.prizePool, 875);
      assert.match(group.prizeDistribution, /2nd: 250 coins/);
      const listedAwards = group.awards.map((award) => ({
          registrationId: award.registrationId,
          userId: award.userId,
          playerName: award.playerName,
          gameName: award.gameName,
          kills: award.kills,
          prizeCoins: award.prizeCoins,
        })).sort((first, second) => first.registrationId.localeCompare(second.registrationId));
      const expectedAwards = fixture.players.slice(0, 2).map((player, index) => ({
        registrationId: player.registrationId,
        userId: player.userId,
        playerName: `Test Player ${index + 1}`,
        gameName: `TestGame${index + 1}`,
        kills: index === 0 ? 7 : 5,
        prizeCoins: index === 0 ? 500 : 250,
      })).sort((first, second) => first.registrationId.localeCompare(second.registrationId));
      assert.deepEqual(listedAwards, expectedAwards);
      assert.ok(group.awards.every((award) => award.awardId && Date.parse(award.createdAt)));
      assert.match(body.correctionGuidance, /does not change results or player balances/i);
      assert.match(body.correctionGuidance, /one transaction/i);

      const denied = await fetch(`${origin}/admin/results/duplicate-placements`, {
        headers: authHeaders(fixture.players[0].userId),
      });
      assert.equal(denied.status, 403, "regular players must not access the Admin audit");
    });

    assert.deepEqual(await captureStoredState(), before, "the audit must leave awards, balances, stats, and ledger unchanged");
  } finally {
    await cleanupFixture(fixture);
  }
});

test("public results stay draft when a cancelled tournament retains a winner award", async () => {
  const userId = randomUUID();
  const matchId = randomUUID();
  const registrationId = randomUUID();

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO daily007_v2_users
           (id, name, email, password_salt, password_hash)
         VALUES ($1, 'Cancelled Results Player', $2, 'test-salt', 'test-hash')`,
        [userId, `cancelled-results-${userId}@example.test`],
      );
      await client.query(
        `INSERT INTO daily007_v2_matches
           (id, title, mode, game_mode, team_type, capacity, starts_at)
         VALUES ($1, 'Cancelled results fixture', 'solo', 'battle_royale',
                 'solo', 48, now() - interval '1 hour')`,
        [matchId],
      );
      await client.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, captain_name, captain_game_name,
            captain_game_uid, entry_coins_paid, status)
         VALUES ($1, $2, $3, 'Cancelled Results Player', 'CancelledWinner',
                 $4, 0, 'approved')`,
        [registrationId, matchId, userId, `uid-${registrationId}`],
      );
      await client.query(
        `INSERT INTO daily007_v2_result_awards
           (match_id, registration_id, user_id, rank, kills, prize_coins)
         VALUES ($1, $2, $3, 1, 12, 500)`,
        [matchId, registrationId, userId],
      );
      const cancelled = await client.query<{ status: string; enabled: boolean }>(
        `UPDATE daily007_v2_matches
            SET status = 'cancelled', enabled = false
          WHERE id = $1
          RETURNING status, enabled`,
        [matchId],
      );
      assert.deepEqual(cancelled.rows, [{ status: "cancelled", enabled: false }]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await withServer(async (origin) => {
      const savedWinner = await pool.query<{ registration_id: string; rank: number }>(
        `SELECT registration_id, rank
           FROM daily007_v2_result_awards
          WHERE match_id = $1`,
        [matchId],
      );
      assert.deepEqual(savedWinner.rows, [{ registration_id: registrationId, rank: 1 }]);

      const standings = await publicStandings(origin, matchId);
      assert.equal(standings.status, 200);
      assert.equal(standings.body.status, "draft");
      assert.deepEqual(
        standings.body.entries,
        [],
        "a cancelled tournament's retained winner award must not appear as finalized results",
      );
    });
  } finally {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM daily007_v2_result_awards WHERE match_id = $1 AND registration_id = $2",
        [matchId, registrationId],
      );
      await client.query(
        "DELETE FROM daily007_v2_registrations WHERE id = $1 AND match_id = $2",
        [registrationId, matchId],
      );
      await client.query("DELETE FROM daily007_v2_matches WHERE id = $1", [matchId]);
      await client.query("DELETE FROM daily007_v2_users WHERE id = $1", [userId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
});

test("Admin recovery returns reverse-inserted unfinalized placements in ascending rank order", async () => {
  const fixture = await createFixture(3);
  const rankTwo = fixture.players[1];
  const rankThree = fixture.players[2];

  try {
    await withServer(async (origin) => {
      const rankThreeResult = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        rankThree,
        3,
        11,
      );
      assert.equal(
        rankThreeResult.status,
        201,
        `rank 3 must be saved first: ${JSON.stringify(rankThreeResult.body)}`,
      );
      assert.equal(rankThreeResult.body.prizeCoins, 125);

      const rankTwoResult = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        rankTwo,
        2,
        7,
      );
      assert.equal(
        rankTwoResult.status,
        201,
        `rank 2 must be saved second: ${JSON.stringify(rankTwoResult.body)}`,
      );
      assert.equal(rankTwoResult.body.prizeCoins, 250);

      const recoveryResponse = await fetch(`${origin}/admin/results?includeUnfinalized=true`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(recoveryResponse.status, 200);
      const recoveryBody = await recoveryResponse.json() as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      assert.equal(recoveryBody.success, true);
      const placements = recoveryBody.data.filter(
        (entry) => entry.tournamentId === fixture.matchId,
      );
      assert.deepEqual(
        placements.map(({ registrationId, rank, prizeCoins }) => ({
          registrationId,
          rank,
          prizeCoins,
        })),
        [
          {
            registrationId: rankTwo.registrationId,
            rank: 2,
            prizeCoins: 250,
          },
          {
            registrationId: rankThree.registrationId,
            rank: 3,
            prizeCoins: 125,
          },
        ],
        "recovery must return the saved registrations and prizes in ascending rank order",
      );

      const persistedRanks = await pool.query<{ rank: number }>(
        `SELECT rank
           FROM daily007_v2_result_awards
          WHERE match_id = $1
          ORDER BY rank`,
        [fixture.matchId],
      );
      assert.deepEqual(persistedRanks.rows, [{ rank: 2 }, { rank: 3 }]);

      const match = await pool.query<{ enabled: boolean; status: string }>(
        "SELECT enabled, status FROM daily007_v2_matches WHERE id = $1",
        [fixture.matchId],
      );
      assert.deepEqual(match.rows, [{ enabled: true, status: "open" }]);

      const completedResponse = await fetch(`${origin}/admin/results`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(completedResponse.status, 200);
      const completedBody = await completedResponse.json() as {
        data: Array<Record<string, unknown>>;
      };
      assert.equal(
        completedBody.data.some((entry) => entry.tournamentId === fixture.matchId),
        false,
        "a tournament with no first-place result must remain out of the completed list",
      );
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("a lost publish response and failed result-log refresh leave one recoverable award", async () => {
  const fixture = await createFixture();
  const runnerUp = fixture.players[1];

  try {
    await withServer(async (origin) => {
      let lostResponseError: unknown;
      try {
        await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      } catch (error) {
        lostResponseError = error;
      }
      assert.ok(lostResponseError, "the committed publish response should be lost to the client");

      const stateAfterLostResponse = await captureSettlementState(fixture, runnerUp);
      assert.deepEqual(stateAfterLostResponse, {
        walletCoins: 350,
        awards: [{
          registration_id: runnerUp.registrationId,
          user_id: runnerUp.userId,
          rank: 2,
          kills: 3,
          prize_coins: 250,
        }],
        stats: { matches: 1, wins: 0, kills: 3, prize_coins: 250 },
        ledger: [{ amount: 250, balance_after: 350, reason: "match_prize" }],
        match: { enabled: true, status: "open" },
      }, "the server must commit the placement and prize before its response is lost");

      const failedRefresh = await fetch(`${origin}/admin/results?includeUnfinalized=true`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(failedRefresh.status, 503, "the first recovery refresh should fail");

      const retry = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(retry.status, 409, "retrying the uncertain result must not publish another award");
      assert.equal(retry.body.error, "A result has already been published for this registration.");

      const recoveryResponse = await fetch(`${origin}/admin/results?includeUnfinalized=true`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(recoveryResponse.status, 200, "result-log recovery should work after the refresh failure");
      const recoveryBody = await recoveryResponse.json() as {
        success: boolean;
        data: Array<Record<string, unknown>>;
      };
      assert.equal(recoveryBody.success, true);
      assert.ok(
        recoveryBody.data.some(
          (entry) =>
            entry.tournamentId === fixture.matchId &&
            entry.registrationId === runnerUp.registrationId &&
            entry.rank === 2 &&
            entry.prizeCoins === 250,
        ),
        "the committed placement must remain available for later recovery",
      );

      const finalState = await captureSettlementState(fixture, runnerUp);
      assert.deepEqual(
        finalState,
        stateAfterLostResponse,
        "recovery and retry must leave exactly one award and one prize credit",
      );
      assert.equal(finalState.awards.length, 1);
      assert.equal(finalState.ledger.length, 1);
    }, {
      dropNextPublishedResultResponse: true,
      failNextResultLogRefresh: true,
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("concurrent first- and second-place results cannot pay one registration twice", async () => {
  const fixture = await createFixture();
  const player = fixture.players[0];
  const otherPlayer = fixture.players[1];
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let submissions: Promise<ResultResponse>[] = [];

  try {
    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [fixture.matchId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = [
        submitResult(origin, fixture.adminId, fixture.matchId, player, 1, 8),
        submitResult(origin, fixture.adminId, fixture.matchId, player, 2, 3),
      ];

      try {
        const waitingRequests = await waitForBlockedResultRequests(blockerPid, 2);
        assert.equal(waitingRequests.length, 2);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);

      const successfulIndex = results.findIndex((result) => result.status === 201);
      const successful = results[successfulIndex];
      const rejected = results.find((result) => result.status === 409);
      assert.ok(successful, "one result rank must be accepted");
      assert.ok(rejected, "the other rank for the same registration must be rejected");
      assert.equal(
        rejected.body.error,
        "A result has already been published for this registration.",
      );

      const successfulRank = successfulIndex === 0 ? 1 : 2;
      const successfulKills = successfulIndex === 0 ? 8 : 3;
      const successfulPrize = successfulRank === 1 ? 500 : 250;
      const successfulBalance = 100 + successfulPrize;
      assert.equal(successful.body.registrationId, player.registrationId);
      assert.equal(successful.body.userId, player.userId);
      assert.equal(successful.body.prizeCoins, successfulPrize);
      assert.equal(successful.body.walletCoins, successfulBalance);

      const standingsAfterRace = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsAfterRace.status, 200);
      if (successfulRank === 1) {
        assert.equal(standingsAfterRace.body.status, "finalized");
        assert.deepEqual(standingsAfterRace.body.entries, [{
          rank: 1,
          kills: successfulKills,
          prizeCoins: successfulPrize,
          gameName: "TestGame1",
          teamName: null,
        }]);
      } else {
        assert.equal(standingsAfterRace.body.status, "draft");
        assert.deepEqual(
          standingsAfterRace.body.entries,
          [],
          "a runner-up result must stay hidden until a winner finalizes standings",
        );
      }

      const playerState = await captureSettlementState(fixture, player);
      assert.deepEqual(playerState, {
        walletCoins: successfulBalance,
        awards: [{
          registration_id: player.registrationId,
          user_id: player.userId,
          rank: successfulRank,
          kills: successfulKills,
          prize_coins: successfulPrize,
        }],
        stats: {
          matches: 1,
          wins: successfulRank === 1 ? 1 : 0,
          kills: successfulKills,
          prize_coins: successfulPrize,
        },
        ledger: [{
          amount: successfulPrize,
          balance_after: successfulBalance,
          reason: "match_prize",
        }],
        match: {
          enabled: successfulRank !== 1,
          status: "open",
        },
      });

      const otherPlayerState = await captureSettlementState(fixture, otherPlayer);
      assert.equal(otherPlayerState.walletCoins, 100);
      assert.equal(otherPlayerState.stats, null);
      assert.deepEqual(otherPlayerState.ledger, []);
      assert.equal(otherPlayerState.awards.length, 1);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("a rank-2-first result remains the only public result for its registration after finalization", async () => {
  const fixture = await createFixture();
  const runnerUp = fixture.players[0];
  const winner = fixture.players[1];

  try {
    await withServer(async (origin) => {
      const runnerUpResult = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        runnerUp,
        2,
        3,
      );
      assert.equal(runnerUpResult.status, 201);
      assert.equal(runnerUpResult.body.registrationId, runnerUp.registrationId);
      assert.equal(runnerUpResult.body.prizeCoins, 250);
      assert.equal(runnerUpResult.body.walletCoins, 350);

      const conflictingWinner = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        runnerUp,
        1,
        8,
      );
      assert.equal(conflictingWinner.status, 409);
      assert.equal(
        conflictingWinner.body.error,
        "A result has already been published for this registration.",
      );

      const standingsBeforeFinalization = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsBeforeFinalization.status, 200);
      assert.equal(standingsBeforeFinalization.body.status, "draft");
      assert.deepEqual(
        standingsBeforeFinalization.body.entries,
        [],
        "unfinished runner-up standings must not expose either submitted rank",
      );

      const winnerResult = await submitResult(
        origin,
        fixture.adminId,
        fixture.matchId,
        winner,
        1,
        6,
      );
      assert.equal(winnerResult.status, 201);
      assert.equal(winnerResult.body.registrationId, winner.registrationId);
      assert.equal(winnerResult.body.prizeCoins, 500);
      assert.equal(winnerResult.body.walletCoins, 600);

      const standingsAfterFinalization = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsAfterFinalization.status, 200);
      assert.equal(standingsAfterFinalization.body.status, "finalized");
      assert.deepEqual(standingsAfterFinalization.body.entries, [
        {
          rank: 1,
          kills: 6,
          prizeCoins: 500,
          gameName: "TestGame2",
          teamName: null,
        },
        {
          rank: 2,
          kills: 3,
          prizeCoins: 250,
          gameName: "TestGame1",
          teamName: null,
        },
      ]);
      const publicEntries = standingsAfterFinalization.body.entries as Array<Record<string, unknown>>;
      assert.deepEqual(
        publicEntries.filter((entry) => entry.gameName === "TestGame1"),
        [{
          rank: 2,
          kills: 3,
          prizeCoins: 250,
          gameName: "TestGame1",
          teamName: null,
        }],
        "the registration must expose only its accepted rank, never the rejected rank",
      );

      const expectedAwards = [
        {
          registration_id: winner.registrationId,
          user_id: winner.userId,
          rank: 1,
          kills: 6,
          prize_coins: 500,
        },
        {
          registration_id: runnerUp.registrationId,
          user_id: runnerUp.userId,
          rank: 2,
          kills: 3,
          prize_coins: 250,
        },
      ];
      assert.deepEqual(await captureSettlementState(fixture, runnerUp), {
        walletCoins: 350,
        awards: expectedAwards,
        stats: {
          matches: 1,
          wins: 0,
          kills: 3,
          prize_coins: 250,
        },
        ledger: [{
          amount: 250,
          balance_after: 350,
          reason: "match_prize",
        }],
        match: {
          enabled: false,
          status: "open",
        },
      });
      assert.deepEqual(await captureSettlementState(fixture, winner), {
        walletCoins: 600,
        awards: expectedAwards,
        stats: {
          matches: 1,
          wins: 1,
          kills: 6,
          prize_coins: 500,
        },
        ledger: [{
          amount: 500,
          balance_after: 600,
          reason: "match_prize",
        }],
        match: {
          enabled: false,
          status: "open",
        },
      });
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("concurrent first-, second-, and third-place results preserve configured prizes and standings", async () => {
  const fixture = await createFixture(3);
  const [winner, runnerUp, thirdPlace] = fixture.players;
  assert.ok(winner && runnerUp && thirdPlace, "three uniquely identified player fixtures are required");
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let submissions: Promise<ResultResponse>[] = [];

  try {
    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        [fixture.matchId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = [
        submitResult(origin, fixture.adminId, fixture.matchId, winner, 1, 7),
        submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3),
        submitResult(origin, fixture.adminId, fixture.matchId, thirdPlace, 3, 5),
      ];

      try {
        const waitingRequests = await waitForBlockedResultRequests(blockerPid, 3);
        assert.equal(waitingRequests.length, 3);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(results.map((result) => result.status), [201, 201, 201]);
      assert.deepEqual(results.map((result) => ({
        registrationId: result.body.registrationId,
        userId: result.body.userId,
        prizeCoins: result.body.prizeCoins,
        walletCoins: result.body.walletCoins,
      })), [
        {
          registrationId: winner.registrationId,
          userId: winner.userId,
          prizeCoins: 500,
          walletCoins: 600,
        },
        {
          registrationId: runnerUp.registrationId,
          userId: runnerUp.userId,
          prizeCoins: 250,
          walletCoins: 350,
        },
        {
          registrationId: thirdPlace.registrationId,
          userId: thirdPlace.userId,
          prizeCoins: 125,
          walletCoins: 225,
        },
      ]);

      const standings = await fetch(`${origin}/tournaments/${fixture.matchId}/results`);
      assert.equal(standings.status, 200);
      const standingsBody = await standings.json() as {
        tournamentId: string;
        status: string;
        finalizedAt: string | null;
        entries: Array<Record<string, unknown>>;
      };
      assert.equal(standingsBody.tournamentId, fixture.matchId);
      assert.equal(standingsBody.status, "finalized");
      assert.ok(standingsBody.finalizedAt);
      assert.match(standingsBody.finalizedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
      assert.deepEqual(standingsBody.entries, [
        {
          rank: 1,
          kills: 7,
          prizeCoins: 500,
          gameName: "TestGame1",
          teamName: null,
        },
        {
          rank: 2,
          kills: 3,
          prizeCoins: 250,
          gameName: "TestGame2",
          teamName: null,
        },
        {
          rank: 3,
          kills: 5,
          prizeCoins: 125,
          gameName: "TestGame3",
          teamName: null,
        },
      ]);

      const adminHistoryResponse = await fetch(`${origin}/admin/results`, {
        headers: authHeaders(fixture.adminId),
      });
      assert.equal(adminHistoryResponse.status, 200);
      const adminHistoryBody = await adminHistoryResponse.json() as {
        success: boolean;
        data: Array<{
          tournamentId: string;
          tournamentName: string;
          registrationId: string;
          playerName: string;
          gameName: string | null;
          teamName: string | null;
          rank: number;
          kills: number;
          prizeCoins: number;
        }>;
      };
      assert.equal(adminHistoryBody.success, true);
      assert.equal(adminHistoryBody.data.length, 3);
      assert.ok(
        adminHistoryBody.data.every((award) => award.tournamentId === fixture.matchId),
        `Admin results must not include unrelated fixture awards: ${JSON.stringify(adminHistoryBody.data)}.`,
      );
      assert.deepEqual(adminHistoryBody.data.map((award) => ({
        tournamentId: award.tournamentId,
        tournamentName: award.tournamentName,
        registrationId: award.registrationId,
        playerName: award.playerName,
        gameName: award.gameName,
        teamName: award.teamName,
        rank: award.rank,
        kills: award.kills,
        prizeCoins: award.prizeCoins,
      })), [
        {
          tournamentId: fixture.matchId,
          tournamentName: "Isolated result race",
          registrationId: winner.registrationId,
          playerName: "Test Player 1",
          gameName: "TestGame1",
          teamName: "",
          rank: 1,
          kills: 7,
          prizeCoins: 500,
        },
        {
          tournamentId: fixture.matchId,
          tournamentName: "Isolated result race",
          registrationId: runnerUp.registrationId,
          playerName: "Test Player 2",
          gameName: "TestGame2",
          teamName: "",
          rank: 2,
          kills: 3,
          prizeCoins: 250,
        },
        {
          tournamentId: fixture.matchId,
          tournamentName: "Isolated result race",
          registrationId: thirdPlace.registrationId,
          playerName: "Test Player 3",
          gameName: "TestGame3",
          teamName: "",
          rank: 3,
          kills: 5,
          prizeCoins: 125,
        },
      ]);
      assert.deepEqual(
        adminHistoryBody.data.map((award) => award.rank),
        [1, 2, 3],
        "Admin results history must include each configured placement exactly once.",
      );

      const awards = await pool.query<{
        registration_id: string;
        user_id: string;
        rank: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT registration_id, user_id, rank, kills, prize_coins
           FROM daily007_v2_result_awards
          WHERE match_id = $1
          ORDER BY rank`,
        [fixture.matchId],
      );
      assert.deepEqual(awards.rows, [
        {
          registration_id: winner.registrationId,
          user_id: winner.userId,
          rank: 1,
          kills: 7,
          prize_coins: 500,
        },
        {
          registration_id: runnerUp.registrationId,
          user_id: runnerUp.userId,
          rank: 2,
          kills: 3,
          prize_coins: 250,
        },
        {
          registration_id: thirdPlace.registrationId,
          user_id: thirdPlace.userId,
          rank: 3,
          kills: 5,
          prize_coins: 125,
        },
      ]);
      assert.equal(awards.rows.filter((award) => award.rank === 1).length, 1);

      const wallets = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[]) ORDER BY id",
        [[winner.userId, runnerUp.userId, thirdPlace.userId]],
      );
      assert.deepEqual(wallets.rows, [
        { id: winner.userId, wallet_coins: 600 },
        { id: runnerUp.userId, wallet_coins: 350 },
        { id: thirdPlace.userId, wallet_coins: 225 },
      ].sort((left, right) => left.id.localeCompare(right.id)));

      const ledger = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT user_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [[winner.userId, runnerUp.userId, thirdPlace.userId]],
      );
      assert.deepEqual(ledger.rows, [
        {
          user_id: winner.userId,
          amount: 500,
          balance_after: 600,
          reason: "match_prize",
        },
        {
          user_id: runnerUp.userId,
          amount: 250,
          balance_after: 350,
          reason: "match_prize",
        },
        {
          user_id: thirdPlace.userId,
          amount: 125,
          balance_after: 225,
          reason: "match_prize",
        },
      ].sort((left, right) => left.user_id.localeCompare(right.user_id)));

      const stats = await pool.query<{
        user_id: string;
        matches: number;
        wins: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT user_id, matches, wins, kills, prize_coins
           FROM daily007_v2_user_stats
          WHERE user_id = ANY($1::uuid[])
          ORDER BY user_id`,
        [[winner.userId, runnerUp.userId, thirdPlace.userId]],
      );
      assert.deepEqual(stats.rows, [
        {
          user_id: winner.userId,
          matches: 1,
          wins: 1,
          kills: 7,
          prize_coins: 500,
        },
        {
          user_id: runnerUp.userId,
          matches: 1,
          wins: 0,
          kills: 3,
          prize_coins: 250,
        },
        {
          user_id: thirdPlace.userId,
          matches: 1,
          wins: 0,
          kills: 5,
          prize_coins: 125,
        },
      ].sort((left, right) => left.user_id.localeCompare(right.user_id)));

      const match = await pool.query<{ enabled: boolean; status: string }>(
        "SELECT enabled, status FROM daily007_v2_matches WHERE id = $1",
        [fixture.matchId],
      );
      assert.deepEqual(match.rows, [{ enabled: false, status: "open" }]);
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupFixture(fixture);
  }
});

test("concurrent tournament payouts preserve one player's wallet history and accumulated stats", async () => {
  const fixture = await createSharedPlayerPayoutFixture();
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let submissions: Promise<ResultResponse>[] = [];

  try {
    await seedExistingPlayerHistory(fixture.registrations[0]);
    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [fixture.playerId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = [
        submitResult(
          origin,
          fixture.adminId,
          fixture.matchIds[0],
          fixture.registrations[0],
          1,
          7,
        ),
        submitResult(
          origin,
          fixture.adminId,
          fixture.matchIds[1],
          fixture.registrations[1],
          2,
          3,
        ),
      ];

      try {
        const waitingRequests = await waitForBlockedWalletPayoutRequests(blockerPid, 2);
        assert.equal(waitingRequests.length, 2);
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const results = await Promise.all(submissions);
      assert.deepEqual(results.map((result) => result.status), [201, 201]);
      assert.deepEqual(
        results.map((result) => ({
          registrationId: result.body.registrationId,
          userId: result.body.userId,
          prizeCoins: result.body.prizeCoins,
        })),
        [
          {
            registrationId: fixture.registrations[0].registrationId,
            userId: fixture.playerId,
            prizeCoins: 300,
          },
          {
            registrationId: fixture.registrations[1].registrationId,
            userId: fixture.playerId,
            prizeCoins: 200,
          },
        ],
        "each tournament must award its configured prize to the shared player",
      );
      const responseBalances = results.map((result) => result.body.walletCoins).sort((a, b) =>
        Number(a) - Number(b),
      );
      assert.ok(
        [1200, 1300].includes(Number(responseBalances[0])) &&
          Number(responseBalances[1]) === 1500,
        `both responses must reflect the serialized wallet balance: ${JSON.stringify(responseBalances)}`,
      );

      const awards = await pool.query<{
        match_id: string;
        registration_id: string;
        user_id: string;
        rank: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT match_id, registration_id, user_id, rank, kills, prize_coins
           FROM daily007_v2_result_awards
          WHERE registration_id = ANY($1::uuid[])
          ORDER BY match_id, registration_id`,
        [fixture.registrations.map((registration) => registration.registrationId)],
      );
      assert.deepEqual(
        awards.rows,
        [
          {
            match_id: fixture.matchIds[0],
            registration_id: fixture.registrations[0].registrationId,
            user_id: fixture.playerId,
            rank: 1,
            kills: 7,
            prize_coins: 300,
          },
          {
            match_id: fixture.matchIds[1],
            registration_id: fixture.registrations[1].registrationId,
            user_id: fixture.playerId,
            rank: 2,
            kills: 3,
            prize_coins: 200,
          },
        ].sort((left, right) =>
          left.match_id.localeCompare(right.match_id) ||
          left.registration_id.localeCompare(right.registration_id),
        ),
        "each result award must persist exactly once",
      );

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.playerId],
      );
      assert.deepEqual(wallet.rows, [{ wallet_coins: 1500 }]);

      const ledger = await pool.query<{
        match_id: string | null;
        registration_id: string | null;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY balance_after`,
        [fixture.playerId],
      );
      assert.equal(ledger.rows.length, 3, "wallet history must contain its original row and two payout credits");
      assert.deepEqual(ledger.rows[0], {
        match_id: null,
        registration_id: null,
        amount: 500,
        balance_after: 1000,
        reason: "match_prize",
      });
      const payoutLedger = ledger.rows.slice(1);
      assert.deepEqual(
        payoutLedger.map(({ match_id, registration_id, amount }) => ({
          match_id,
          registration_id,
          amount,
        })).sort((left, right) => left.match_id!.localeCompare(right.match_id!)),
        [
          {
            match_id: fixture.matchIds[0],
            registration_id: fixture.registrations[0].registrationId,
            amount: 300,
          },
          {
            match_id: fixture.matchIds[1],
            registration_id: fixture.registrations[1].registrationId,
            amount: 200,
          },
        ].sort((left, right) => left.match_id.localeCompare(right.match_id)),
        "each prize ledger credit must reference its own tournament and registration",
      );
      assert.deepEqual(
        payoutLedger.map((entry) => entry.amount).sort((left, right) => left - right),
        [200, 300],
        "each configured prize must be credited once",
      );
      let expectedBalance = 1000;
      for (const entry of payoutLedger) {
        assert.equal(entry.reason, "match_prize");
        expectedBalance += entry.amount;
        assert.equal(entry.balance_after, expectedBalance, "ledger balances must reflect both serialized credits");
      }
      assert.equal(expectedBalance, 1500);

      const stats = await pool.query<{
        matches: number;
        wins: number;
        kills: number;
        prize_coins: number;
      }>(
        `SELECT matches, wins, kills, prize_coins
           FROM daily007_v2_user_stats
          WHERE user_id = $1`,
        [fixture.playerId],
      );
      assert.deepEqual(stats.rows, [{
        matches: 7,
        wins: 2,
        kills: 52,
        prize_coins: 1000,
      }], "both results must increment the player's existing statistics");
    });
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled(submissions);
    await cleanupSharedPlayerPayoutFixture(fixture);
  }
});

test("failed runner-up payout preserves the earlier winner and permits one retry", async () => {
  const fixture = await createFixture();
  const [winner, runnerUp] = fixture.players;
  assert.ok(winner && runnerUp, "winner and runner-up fixtures are required");

  try {
    await seedExistingPlayerHistory(runnerUp);
    await withServer(async (origin) => {
      const winningResult = await submitResult(origin, fixture.adminId, fixture.matchId, winner, 1, 7);
      assert.equal(
        winningResult.status,
        201,
        `the first-place payout must commit before the runner-up attempt: ${JSON.stringify(winningResult.body)}`,
      );
      assert.equal(winningResult.body.prizeCoins, 500);
      assert.equal(winningResult.body.walletCoins, 600);

      const winnerStateAfterFirst = await captureSettlementState(fixture, winner);
      assert.deepEqual(winnerStateAfterFirst, {
        walletCoins: 600,
        awards: [{
          registration_id: winner.registrationId,
          user_id: winner.userId,
          rank: 1,
          kills: 7,
          prize_coins: 500,
        }],
        stats: { matches: 1, wins: 1, kills: 7, prize_coins: 500 },
        ledger: [{ amount: 500, balance_after: 600, reason: "match_prize" }],
        match: { enabled: false, status: "open" },
      });
      const runnerUpStateBefore = await captureSettlementState(fixture, runnerUp);
      assert.deepEqual(runnerUpStateBefore, {
        walletCoins: 1000,
        awards: winnerStateAfterFirst.awards,
        stats: { matches: 5, wins: 1, kills: 42, prize_coins: 500 },
        ledger: [{ amount: 500, balance_after: 1000, reason: "match_prize" }],
        match: winnerStateAfterFirst.match,
      });

      const standingsBeforeFailure = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsBeforeFailure.status, 200);
      assert.equal(standingsBeforeFailure.body.status, "finalized");
      assert.deepEqual(standingsBeforeFailure.body.entries, [{
        rank: 1,
        kills: 7,
        prizeCoins: 500,
        gameName: "TestGame1",
        teamName: null,
      }]);

      await installRunnerUpLedgerFailure(runnerUp.userId);
      const failed = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(failed.status, 500, `expected injected database failure: ${JSON.stringify(failed.body)}`);

      const failureEvidence = await pool.query<{ last_value: string; is_called: boolean }>(
        "SELECT last_value::text, is_called FROM daily007_test_result_failure_observed_seq",
      );
      assert.equal(Number(failureEvidence.rows[0]?.last_value), 1);
      assert.equal(
        failureEvidence.rows[0]?.is_called,
        true,
        "the failure trigger must run after the runner-up award, stats, and wallet update are attempted",
      );

      assert.deepEqual(
        await captureSettlementState(fixture, winner),
        winnerStateAfterFirst,
        "the previously committed winner award, wallet, ledger, stats, and match state must remain unchanged",
      );
      assert.deepEqual(
        await captureSettlementState(fixture, runnerUp),
        runnerUpStateBefore,
        "the failed runner-up award, wallet credit, ledger row, and stats must all roll back",
      );
      const standingsAfterFailure = await publicStandings(origin, fixture.matchId);
      assert.deepEqual(
        standingsAfterFailure,
        standingsBeforeFailure,
        "the published winner standings must remain unchanged after the runner-up failure",
      );

      await removeRunnerUpLedgerFailure();
      const retry = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(retry.status, 201, `retry should succeed: ${JSON.stringify(retry.body)}`);
      assert.equal(retry.body.registrationId, runnerUp.registrationId);
      assert.equal(retry.body.userId, runnerUp.userId);
      assert.equal(retry.body.prizeCoins, 250);
      assert.equal(retry.body.walletCoins, 1250);

      const winnerAfterRetry = await captureSettlementState(fixture, winner);
      assert.equal(winnerAfterRetry.walletCoins, winnerStateAfterFirst.walletCoins);
      assert.deepEqual(winnerAfterRetry.stats, winnerStateAfterFirst.stats);
      assert.deepEqual(winnerAfterRetry.ledger, winnerStateAfterFirst.ledger);
      assert.deepEqual(winnerAfterRetry.match, winnerStateAfterFirst.match);
      assert.equal(winnerAfterRetry.awards.length, 2);
      assert.deepEqual(winnerAfterRetry.awards[0], winnerStateAfterFirst.awards[0]);

      const runnerUpAfterRetry = await captureSettlementState(fixture, runnerUp);
      assert.equal(runnerUpAfterRetry.walletCoins, 1250);
      assert.deepEqual(runnerUpAfterRetry.awards, [{
        registration_id: winner.registrationId,
        user_id: winner.userId,
        rank: 1,
        kills: 7,
        prize_coins: 500,
      }, {
        registration_id: runnerUp.registrationId,
        user_id: runnerUp.userId,
        rank: 2,
        kills: 3,
        prize_coins: 250,
      }]);
      assert.deepEqual(runnerUpAfterRetry.stats, {
        matches: 6,
        wins: 1,
        kills: 45,
        prize_coins: 750,
      });
      assert.deepEqual(
        [...runnerUpAfterRetry.ledger].sort((left, right) => left.balance_after - right.balance_after),
        [
          { amount: 500, balance_after: 1000, reason: "match_prize" },
          { amount: 250, balance_after: 1250, reason: "match_prize" },
        ],
      );
      const tournamentPayoutLedger = await pool.query<{
        match_id: string;
        registration_id: string;
        user_id: string;
        amount: number;
        balance_after: number;
      }>(
        `SELECT match_id, registration_id, user_id, amount, balance_after
           FROM daily007_v2_wallet_ledger
          WHERE match_id = $1 AND reason = 'match_prize'
          ORDER BY registration_id`,
        [fixture.matchId],
      );
      assert.deepEqual(tournamentPayoutLedger.rows, [
        {
          match_id: fixture.matchId,
          registration_id: winner.registrationId,
          user_id: winner.userId,
          amount: 500,
          balance_after: 600,
        },
        {
          match_id: fixture.matchId,
          registration_id: runnerUp.registrationId,
          user_id: runnerUp.userId,
          amount: 250,
          balance_after: 1250,
        },
      ].sort((left, right) => left.registration_id.localeCompare(right.registration_id)));
      assert.deepEqual(runnerUpAfterRetry.match, winnerStateAfterFirst.match);

      const standingsAfterRetry = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsAfterRetry.status, 200);
      assert.equal(standingsAfterRetry.body.status, "finalized");
      assert.deepEqual(standingsAfterRetry.body.entries, [
        {
          rank: 1,
          kills: 7,
          prizeCoins: 500,
          gameName: "TestGame1",
          teamName: null,
        },
        {
          rank: 2,
          kills: 3,
          prizeCoins: 250,
          gameName: "TestGame2",
          teamName: null,
        },
      ]);

      const duplicate = await submitResult(origin, fixture.adminId, fixture.matchId, runnerUp, 2, 3);
      assert.equal(duplicate.status, 409);
      assert.deepEqual(await captureSettlementState(fixture, runnerUp), runnerUpAfterRetry);
    });
  } finally {
    try {
      await removeRunnerUpLedgerFailure();
    } finally {
      await cleanupFixture(fixture);
    }
  }
});

test("a failed first-place payout rolls back completely and the winner can retry", async () => {
  const fixture = await createFixture();
  const winner = fixture.players[0];
  assert.ok(winner, "a winner fixture is required");
  const failureObjects = firstPlaceFailureObjectNames();

  try {
    await withServer(async (origin) => {
      const beforeFailure = await captureSettlementState(fixture, winner);
      assert.deepEqual(beforeFailure, {
        walletCoins: 100,
        awards: [],
        stats: null,
        ledger: [],
        match: { enabled: true, status: "open" },
      });
      const standingsBeforeFailure = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsBeforeFailure.status, 200);
      assert.equal(standingsBeforeFailure.body.status, "draft");
      assert.deepEqual(standingsBeforeFailure.body.entries, []);

      await installOneShotFirstPlaceLedgerFailure(failureObjects, winner, fixture.matchId);
      const failed = await submitResult(origin, fixture.adminId, fixture.matchId, winner, 1, 7);
      assert.equal(failed.status, 500, `expected injected database failure: ${JSON.stringify(failed.body)}`);

      const failureEvidence = await pool.query<{ last_value: string; is_called: boolean }>(
        `SELECT last_value::text, is_called FROM ${failureObjects.sequence}`,
      );
      assert.deepEqual(
        failureEvidence.rows,
        [{ last_value: "1", is_called: true }],
        "the one-shot failure must occur at the first-place prize ledger insert",
      );
      assert.deepEqual(
        await captureSettlementState(fixture, winner),
        beforeFailure,
        "the failed attempt must leave wallet, award, stats, ledger, and tournament state unchanged",
      );
      const standingsAfterFailure = await publicStandings(origin, fixture.matchId);
      assert.deepEqual(
        standingsAfterFailure,
        standingsBeforeFailure,
        "a failed first-place payout must not finalize or expose standings",
      );

      const retry = await submitResult(origin, fixture.adminId, fixture.matchId, winner, 1, 7);
      assert.equal(retry.status, 201, `retry should succeed: ${JSON.stringify(retry.body)}`);
      assert.equal(retry.body.registrationId, winner.registrationId);
      assert.equal(retry.body.userId, winner.userId);
      assert.equal(retry.body.prizeCoins, 500);
      assert.equal(retry.body.walletCoins, 600);

      const retryEvidence = await pool.query<{ last_value: string; is_called: boolean }>(
        `SELECT last_value::text, is_called FROM ${failureObjects.sequence}`,
      );
      assert.deepEqual(
        retryEvidence.rows,
        [{ last_value: "2", is_called: true }],
        "the retry must pass the same trigger after the one-shot database failure",
      );

      const finalState = await captureSettlementState(fixture, winner);
      assert.deepEqual(finalState, {
        walletCoins: 600,
        awards: [{
          registration_id: winner.registrationId,
          user_id: winner.userId,
          rank: 1,
          kills: 7,
          prize_coins: 500,
        }],
        stats: { matches: 1, wins: 1, kills: 7, prize_coins: 500 },
        ledger: [{ amount: 500, balance_after: 600, reason: "match_prize" }],
        match: { enabled: false, status: "open" },
      }, "the retry must persist exactly one first-place award and payout");

      const payoutRows = await pool.query<{
        match_id: string;
        registration_id: string;
        user_id: string;
        amount: number;
        balance_after: number;
      }>(
        `SELECT match_id, registration_id, user_id, amount, balance_after
           FROM daily007_v2_wallet_ledger
          WHERE match_id = $1 AND reason = 'match_prize'`,
        [fixture.matchId],
      );
      assert.deepEqual(payoutRows.rows, [{
        match_id: fixture.matchId,
        registration_id: winner.registrationId,
        user_id: winner.userId,
        amount: 500,
        balance_after: 600,
      }], "the tournament must have exactly one payout, for the retried winner");

      const standingsAfterRetry = await publicStandings(origin, fixture.matchId);
      assert.equal(standingsAfterRetry.status, 200);
      assert.equal(standingsAfterRetry.body.status, "finalized");
      assert.deepEqual(standingsAfterRetry.body.entries, [{
        rank: 1,
        kills: 7,
        prizeCoins: 500,
        gameName: "TestGame1",
        teamName: null,
      }], "finalized standings must contain only the successfully paid winner");
    });
  } finally {
    try {
      await removeOneShotFirstPlaceLedgerFailure(failureObjects);
    } finally {
      await cleanupFixture(fixture);
    }
  }
});
