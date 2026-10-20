import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";
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

type Teammate = { name: string; uid: string };

type WalletRaceFixture = {
  userId: string;
  matchIds: [string, string];
  gameUids: [string, string];
  teamType: "solo" | "duo" | "squad";
  teamNames: [string, string];
  teammates: [Teammate[], Teammate[]];
  entryCoins: [number, number];
  startingWalletCoins: number;
};

const STARTING_WALLET_COINS = 100;

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007CompatCoreRouter);
  app.use(daily007CompatExtraRouter);
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
  team: { teammates: Teammate[]; teamName: string } | null,
  captainGameName = "Concurrent Test Player",
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/register`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      captainGameName,
      captainGameUid: gameUid,
      ...(team
        ? { teamName: team.teamName, teammates: team.teammates }
        : { teammates: [] }),
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function updateMatchEntryFee(
  origin: string,
  userId: string,
  matchId: string,
  entryCoins: number,
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/daily007/v2/admin/matches/${matchId}`, {
    method: "PATCH",
    headers: authHeaders(userId),
    body: JSON.stringify({ entryCoins }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function requestWithdrawal(
  origin: string,
  userId: string,
  coins: number,
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/withdrawals`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({ coins, method: "UPI", account: "wallet-race@example.test" }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function adjustWalletCoins(
  origin: string,
  adminId: string,
  targetId: string,
  coinsDelta: number,
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/admin/users/${targetId}`, {
    method: "PATCH",
    headers: authHeaders(adminId),
    body: JSON.stringify({
      coinsDelta,
      note: "concurrent wallet adjustment",
      requestId: randomUUID(),
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function editTeam(
  origin: string,
  userId: string,
  registrationId: string,
  body: Record<string, unknown>,
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/my/registrations/${registrationId}/team`, {
    method: "PATCH",
    headers: authHeaders(userId),
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function blockAccount(
  origin: string,
  adminId: string,
  targetId: string,
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/admin/users/${targetId}`, {
    method: "PATCH",
    headers: authHeaders(adminId),
    body: JSON.stringify({ status: "blocked" }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function createFullAdminActor(): Promise<string> {
  const adminId = randomUUID();
  await pool.query(
    `INSERT INTO daily007_v2_users
       (id, name, email, password_salt, password_hash, role, wallet_coins)
     VALUES ($1, 'Registration Race Admin', $2, 'test-salt', 'test-hash', 'admin', 0)`,
    [adminId, `admin-${adminId}@example.test`],
  );
  return adminId;
}

async function createFixture(
  teamType: "solo" | "duo" | "squad",
  options: { entryCoins?: [number, number]; startingWalletCoins?: number } = {},
): Promise<WalletRaceFixture> {
  const entryCoins: [number, number] = options.entryCoins ?? [7, 13];
  const startingWalletCoins = options.startingWalletCoins ?? STARTING_WALLET_COINS;
  const teammateCount = teamType === "squad" ? 3 : teamType === "duo" ? 1 : 0;
  const createTeammates = (tournamentIndex: number): Teammate[] =>
    Array.from({ length: teammateCount }, (_, teammateIndex) => ({
      name: `Wallet Race ${teamType} Tournament ${tournamentIndex + 1} Player ${teammateIndex + 2}`,
      uid: `ff-${randomUUID()}`,
    }));
  const fixture: WalletRaceFixture = {
    userId: randomUUID(),
    matchIds: [randomUUID(), randomUUID()],
    gameUids: [`ff-${randomUUID()}`, `ff-${randomUUID()}`],
    teamType,
    teamNames: [`Wallet race ${teamType} ${randomUUID()}`, `Wallet race ${teamType} ${randomUUID()}`],
    teammates: [createTeammates(0), createTeammates(1)],
    entryCoins,
    startingWalletCoins,
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Wallet Race Player', $2, 'test-salt', 'test-hash', $3)`,
      [fixture.userId, `player-${fixture.userId}@example.test`, fixture.startingWalletCoins],
    );
    for (const [index, matchId] of fixture.matchIds.entries()) {
      const storageMode = teamType === "solo" ? "solo" : "squad";
      const capacity = teamType === "solo" ? 48 : teamType === "duo" ? 24 : 12;
      await client.query(
        `INSERT INTO daily007_v2_matches
           (id, title, mode, game_mode, team_type, capacity, entry_coins, starts_at, status)
         VALUES ($1, $2, $3, 'battle_royale', $4, $5, $6, now() + interval '1 day', 'open')`,
        [
          matchId,
          `Wallet race tournament ${index + 1}`,
          storageMode,
          teamType,
          capacity,
          fixture.entryCoins[index]!,
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

async function cleanupFixture(fixture: WalletRaceFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1 OR match_id = ANY($2::uuid[])",
      [fixture.userId, fixture.matchIds],
    );
    await client.query("DELETE FROM daily007_v2_withdrawals WHERE user_id = $1", [fixture.userId]);
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

async function waitForBlockedRequests(
  blockerPid: number,
  expectedCount: number,
  queryFragment: string,
  lockDescription: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query ILIKE $1
        ORDER BY activity.query_start`,
      [`%${queryFragment}%`],
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(result.rows.length, expectedCount, `Only the ${expectedCount} competing requests should be waiting.`);
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.map(Number).includes(blockerPid)),
        `At least one request must be waiting directly on the test ${lockDescription} lock.`,
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => Number(pid) === blockerPid || requestPids.has(Number(pid))),
        ),
        `Each request must be queued behind the test ${lockDescription} lock or an earlier waiting request.`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} requests to block on the ${lockDescription} row.`);
}

async function waitForAdvisoryPausedBackend(
  pauseKey: bigint,
  pauseHolderPid: number,
  lockDescription: string,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND $1::integer = ANY(pg_blocking_pids(activity.pid))
        ORDER BY activity.query_start`,
      [pauseHolderPid],
    );
    if (result.rows.length > 0) {
      assert.equal(result.rows.length, 1, `Only one request should be waiting at the ${lockDescription} pause (${pauseKey}).`);
      const paused = result.rows[0]!;
      assert.ok(
        paused.blockers.map(Number).includes(pauseHolderPid),
        `The ${lockDescription} request must be waiting on the test advisory lock.`,
      );
      return Number(paused.pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for a request to reach the ${lockDescription} pause.`);
}

async function waitForBackendBlockedBy(
  blockerPid: number,
  lockDescription: string,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number }>(
      `SELECT activity.pid
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND $1::integer = ANY(pg_blocking_pids(activity.pid))
        ORDER BY activity.query_start`,
      [blockerPid],
    );
    if (result.rows.length > 0) {
      assert.equal(result.rows.length, 1, `Only one request should be queued on the ${lockDescription} lock.`);
      return Number(result.rows[0]!.pid);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for a request to block on the ${lockDescription} lock.`);
}

async function installAccountActionPause(
  action: "registration" | "team_edit",
  targetId: string,
  pauseKey: bigint,
): Promise<() => Promise<void>> {
  const suffix = randomUUID().replace(/-/g, "");
  const functionName = `daily007_test_pause_account_action_${suffix}`;
  const triggerName = `daily007_test_pause_account_action_${suffix}`;
  const event = action === "registration"
    ? "BEFORE INSERT"
    : "BEFORE UPDATE OF captain_game_name, captain_game_uid, team_name";
  const targetExpression = action === "registration" ? "NEW.match_id" : "NEW.id";

  await pool.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
    BEGIN
      IF ${targetExpression} = '${targetId}'::uuid THEN
        PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  try {
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      ${event} ON daily007_v2_registrations
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
  } catch (error) {
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    throw error;
  }
  return async () => {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON daily007_v2_registrations`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
  };
}

async function installEntryFeeRacePause(
  matchId: string,
  stage: "admin_update" | "join_insert",
  pauseKey: bigint,
): Promise<() => Promise<void>> {
  const suffix = randomUUID().replace(/-/g, "");
  const functionName = `daily007_test_pause_fee_race_${suffix}`;
  const triggerName = `daily007_test_pause_fee_race_${suffix}`;
  const functionBody = stage === "admin_update"
    ? `IF NEW.id = '${matchId}'::uuid AND NEW.entry_coins IS DISTINCT FROM OLD.entry_coins THEN
         PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
       END IF;`
    : `IF NEW.match_id = '${matchId}'::uuid THEN
         PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
       END IF;`;
  const table = stage === "admin_update" ? "daily007_v2_matches" : "daily007_v2_registrations";
  const event = stage === "admin_update" ? "BEFORE UPDATE OF entry_coins" : "BEFORE INSERT";
  await pool.query(`
    CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
    BEGIN
      ${functionBody}
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  try {
    await pool.query(`
      CREATE TRIGGER ${triggerName}
      ${event} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION ${functionName}()
    `);
  } catch (error) {
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    throw error;
  }
  return async () => {
    await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table}`);
    await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
  };
}

async function runEntryFeeChangeRace(
  lockWinner: "admin" | "join",
  options: { startingWalletCoins?: number } = {},
): Promise<void> {
  const fixture = await createFixture("solo", {
    entryCoins: [13, 17],
    startingWalletCoins: options.startingWalletCoins ?? 50,
  });
  const matchId = fixture.matchIds[0];
  const oldFee = fixture.entryCoins[0];
  const newFee = 17;
  const expectedPaidFee = lockWinner === "admin" ? newFee : oldFee;
  const pauseKey = BigInt(`0x${randomUUID().replace(/-/g, "").slice(0, 15)}`);
  let dropPause: (() => Promise<void>) | undefined;
  let pauseHolder: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let submissions: Promise<RegistrationResponse>[] = [];

  try {
    await pool.query(
      "UPDATE daily007_v2_users SET role = 'tournament_admin' WHERE id = $1",
      [fixture.userId],
    );
    dropPause = await installEntryFeeRacePause(
      matchId,
      lockWinner === "admin" ? "admin_update" : "join_insert",
      pauseKey,
    );
    pauseHolder = await pool.connect();
    await pauseHolder.query("SELECT pg_advisory_lock($1::bigint)", [pauseKey.toString()]);
    const pauseHolderPid = await backendPid(pauseHolder);

    await withServer(async (origin) => {
      const before = await readEntryPaymentState(fixture, matchId);
      let join: Promise<RegistrationResponse>;
      let feeUpdate: Promise<RegistrationResponse>;
      let joinPid: number;
      let updatePid: number;
      try {
        if (lockWinner === "admin") {
          feeUpdate = updateMatchEntryFee(origin, fixture.userId, matchId, newFee);
          submissions.push(feeUpdate);
          updatePid = await waitForAdvisoryPausedBackend(
            pauseKey,
            pauseHolderPid,
            "admin fee update",
          );
          join = registerForMatch(origin, fixture.userId, matchId, fixture.gameUids[0], null);
          submissions.push(join);
          await waitForBackendBlockedBy(
            updatePid,
            "match",
          );
        } else {
          join = registerForMatch(origin, fixture.userId, matchId, fixture.gameUids[0], null);
          submissions.push(join);
          joinPid = await waitForAdvisoryPausedBackend(
            pauseKey,
            pauseHolderPid,
            "join registration insert",
          );
          feeUpdate = updateMatchEntryFee(origin, fixture.userId, matchId, newFee);
          submissions.push(feeUpdate);
          await waitForBackendBlockedBy(
            joinPid,
            "match",
          );
        }
      } finally {
        await pauseHolder!.query("SELECT pg_advisory_unlock($1::bigint)", [pauseKey.toString()]);
      }

      const [joinResponse, feeResponse] = await Promise.all([join!, feeUpdate!]);
      assert.equal(feeResponse.status, 200, JSON.stringify(feeResponse.body));
      assert.equal(
        (feeResponse.body.match as Record<string, unknown>).entryCoins,
        newFee,
      );

      if (fixture.startingWalletCoins < expectedPaidFee) {
        assert.equal(joinResponse.status, 409, JSON.stringify(joinResponse.body));
        assert.deepEqual(joinResponse.body, {
          error: `Insufficient wallet balance: this entry costs ${expectedPaidFee} coins.`,
          code: "INSUFFICIENT_BALANCE",
        });
        assert.deepEqual(
          await readEntryPaymentState(fixture, matchId),
          before,
          "the rejected join must leave wallet, registration, roster, and ledger unchanged",
        );
      } else {
        assert.equal(joinResponse.status, 201, JSON.stringify(joinResponse.body));
        assert.equal(joinResponse.body.entryCoinsPaid, expectedPaidFee);
        assert.equal(joinResponse.body.walletCoins, fixture.startingWalletCoins - expectedPaidFee);

        const after = await readEntryPaymentState(fixture, matchId);
        assert.deepEqual(after.wallet, [{
          wallet_coins: fixture.startingWalletCoins - expectedPaidFee,
        }]);
        assert.deepEqual(after.registrations, [{
          id: joinResponse.body.registrationId,
          entry_coins_paid: expectedPaidFee,
          status: "approved",
        }]);
        assert.deepEqual(after.ledger, [{
          registration_id: joinResponse.body.registrationId,
          amount: -expectedPaidFee,
          balance_after: fixture.startingWalletCoins - expectedPaidFee,
          reason: "match_entry",
        }]);
      }

      const storedFee = await pool.query<{ entry_coins: number }>(
        "SELECT entry_coins FROM daily007_v2_matches WHERE id = $1",
        [matchId],
      );
      assert.equal(storedFee.rows[0]?.entry_coins, newFee);
    });
  } finally {
    await pauseHolder?.query("SELECT pg_advisory_unlock($1::bigint)", [pauseKey.toString()]).catch(() => undefined);
    pauseHolder?.release();
    await Promise.allSettled(submissions);
    try {
      await dropPause?.();
    } finally {
      await cleanupFixture(fixture);
    }
  }
}

async function runAfterAuthenticationBlockRace(
  origin: string,
  fixture: WalletRaceFixture,
  matchId: string,
  queryFragment: string,
  request: () => Promise<RegistrationResponse>,
): Promise<RegistrationResponse> {
  const blocker = await pool.connect();
  let transactionOpen = false;
  let submission: Promise<RegistrationResponse> | undefined;
  try {
    await blocker.query("BEGIN");
    transactionOpen = true;
    await blocker.query("SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE", [matchId]);
    const blockerPid = await backendPid(blocker);

    submission = request();
    await waitForBlockedRequests(blockerPid, 1, queryFragment, "match");

    // The request has already passed authentication and is now waiting before
    // its transactional write. Commit the block first, then let it proceed.
    await blocker.query("UPDATE daily007_v2_users SET status = 'blocked' WHERE id = $1", [fixture.userId]);
    await blocker.query("COMMIT");
    transactionOpen = false;
    return await submission;
  } finally {
    if (transactionOpen) await blocker.query("ROLLBACK");
    blocker.release();
    if (submission) await Promise.allSettled([submission]);
  }
}

async function runAccountBlockAfterPlayerActionLockRace(
  origin: string,
  fixture: WalletRaceFixture,
  adminId: string,
  action: "registration" | "team_edit",
  targetId: string,
  request: () => Promise<RegistrationResponse>,
): Promise<{ playerAction: RegistrationResponse; accountBlock: RegistrationResponse }> {
  const pauseKey = BigInt(`0x${randomUUID().replace(/-/g, "").slice(0, 15)}`);
  let dropPause: (() => Promise<void>) | undefined;
  let pauseHolder: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let playerAction: Promise<RegistrationResponse> | undefined;
  let accountBlock: Promise<RegistrationResponse> | undefined;

  try {
    dropPause = await installAccountActionPause(action, targetId, pauseKey);
    pauseHolder = await pool.connect();
    await pauseHolder.query("SELECT pg_advisory_lock($1::bigint)", [pauseKey.toString()]);
    const pauseHolderPid = await backendPid(pauseHolder);

    playerAction = request();
    const playerActionPid = await waitForAdvisoryPausedBackend(
      pauseKey,
      pauseHolderPid,
      `the ${action} after its account lock`,
    );
    accountBlock = blockAccount(origin, adminId, fixture.userId);
    const blockBackendPid = await waitForBackendBlockedBy(playerActionPid, "the account block");
    const blockedQuery = await pool.query<{ query: string; blockers: number[] }>(
      `SELECT query, pg_blocking_pids(pid) AS blockers
         FROM pg_stat_activity
        WHERE pid = $1`,
      [blockBackendPid],
    );
    assert.equal(blockedQuery.rows.length, 1);
    assert.match(
      blockedQuery.rows[0]!.query,
      /SELECT wallet_coins FROM daily007_v2_users WHERE id = \$1 FOR UPDATE/i,
      "the block must be waiting for the target account row lock",
    );
    assert.ok(
      blockedQuery.rows[0]!.blockers.map(Number).includes(playerActionPid),
      "PostgreSQL must report the player action as blocking the account update",
    );

    await pauseHolder.query("SELECT pg_advisory_unlock($1::bigint)", [pauseKey.toString()]);
    const [playerActionResponse, accountBlockResponse] = await Promise.all([playerAction, accountBlock]);
    return { playerAction: playerActionResponse, accountBlock: accountBlockResponse };
  } finally {
    await pauseHolder?.query("SELECT pg_advisory_unlock($1::bigint)", [pauseKey.toString()]).catch(() => undefined);
    await Promise.allSettled(
      [playerAction, accountBlock].filter(
        (request): request is Promise<RegistrationResponse> => request !== undefined,
      ),
    );
    pauseHolder?.release();
    await dropPause?.();
  }
}

function pauseNextTransactionConnectionAfterAuthentication() {
  let signalReached!: () => void;
  let releaseConnection!: () => void;
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  const connectionGate = new Promise<void>((resolve) => {
    releaseConnection = resolve;
  });
  const originalConnect = pool.connect;
  const boundOriginalConnect = originalConnect.bind(pool);
  let paused = false;

  pool.connect = ((...args: unknown[]) => {
    if (!paused && args.length === 0) {
      paused = true;
      signalReached();
      return connectionGate.then(() => boundOriginalConnect());
    }
    return Reflect.apply(boundOriginalConnect, undefined, args);
  }) as unknown as typeof pool.connect;

  return {
    reached,
    release: releaseConnection,
    restore: () => {
      pool.connect = originalConnect;
    },
  };
}

async function readBlockedRaceState(fixture: WalletRaceFixture, matchId: string) {
  const [account, registrations, roster, ledger] = await Promise.all([
    pool.query<{ status: string; wallet_coins: number }>(
      "SELECT status, wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.userId],
    ),
    pool.query(
      `SELECT id, match_id, captain_user_id, captain_name, captain_game_name,
              captain_game_uid, team_name, entry_coins_paid, status
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND captain_user_id = $2
        ORDER BY id`,
      [matchId, fixture.userId],
    ),
    pool.query(
      `SELECT roster.registration_id, roster.position, roster.member_uid, roster.member_name
         FROM daily007_v2_roster roster
         JOIN daily007_v2_registrations registration ON registration.id = roster.registration_id
        WHERE registration.match_id = $1 AND registration.captain_user_id = $2
        ORDER BY roster.registration_id, roster.position`,
      [matchId, fixture.userId],
    ),
    pool.query(
      `SELECT match_id, registration_id, amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND match_id = $2
        ORDER BY id`,
      [fixture.userId, matchId],
    ),
  ]);
  return {
    account: account.rows,
    registrations: registrations.rows,
    roster: roster.rows,
    ledger: ledger.rows,
  };
}

test("a registration authenticated before an account block cannot commit afterward", async () => {
  const fixture = await createFixture("duo");
  try {
    await withServer(async (origin) => {
      const matchId = fixture.matchIds[0];
      const before = await readBlockedRaceState(fixture, matchId);
      assert.deepEqual(before, {
        account: [{ status: "active", wallet_coins: fixture.startingWalletCoins }],
        registrations: [],
        roster: [],
        ledger: [],
      });
      const response = await runAfterAuthenticationBlockRace(
        origin,
        fixture,
        matchId,
        "FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
        () => registerForMatch(origin, fixture.userId, matchId, fixture.gameUids[0], {
          teamName: fixture.teamNames[0],
          teammates: fixture.teammates[0],
        }),
      );
      assert.equal(response.status, 403, JSON.stringify(response.body));
      assert.deepEqual(response.body, { error: "This account is blocked." });
      assert.deepEqual(await readBlockedRaceState(fixture, matchId), {
        ...before,
        account: [{ status: "blocked", wallet_coins: fixture.startingWalletCoins }],
      });
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("a blocked retry cannot return an existing registration after authentication", async () => {
  const fixture = await createFixture("duo");
  try {
    await withServer(async (origin) => {
      const matchId = fixture.matchIds[0];
      const initialTeam = {
        teamName: fixture.teamNames[0],
        teammates: fixture.teammates[0],
      };
      const created = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[0],
        initialTeam,
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.alreadyRegistered, false);

      const before = await readBlockedRaceState(fixture, matchId);
      assert.equal(before.account[0]?.status, "active");
      assert.equal(before.registrations.length, 1);
      assert.equal(before.registrations[0]?.id, created.body.registrationId);
      assert.equal(before.roster.length, fixture.teammates[0].length);
      assert.equal(before.ledger.length, 1);

      const blocker = await pool.connect();
      let blockTransactionOpen = false;
      let retry: Promise<RegistrationResponse> | undefined;
      const connectionPause = pauseNextTransactionConnectionAfterAuthentication();
      try {
        await blocker.query("BEGIN");
        blockTransactionOpen = true;
        const blockUpdate = await blocker.query(
          "UPDATE daily007_v2_users SET status = 'blocked' WHERE id = $1",
          [fixture.userId],
        );
        assert.equal(blockUpdate.rowCount, 1);

        retry = registerForMatch(
          origin,
          fixture.userId,
          matchId,
          fixture.gameUids[1],
          {
            teamName: fixture.teamNames[1],
            teammates: fixture.teammates[1],
          },
          "Changed Retry Captain",
        );

        let gateTimeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            connectionPause.reached,
            new Promise<never>((_resolve, reject) => {
              gateTimeout = setTimeout(
                () => reject(new Error("The retry did not pass authentication and reach the pre-transaction pause.")),
                5_000,
              );
            }),
          ]);
        } finally {
          if (gateTimeout) clearTimeout(gateTimeout);
        }

        // Authentication observed the prior active status. Commit the block
        // before allowing the retry to acquire its transaction connection.
        await blocker.query("COMMIT");
        blockTransactionOpen = false;
        connectionPause.release();

        const response = await retry;
        assert.equal(response.status, 403, JSON.stringify(response.body));
        assert.deepEqual(response.body, { error: "This account is blocked." });
        assert.deepEqual(await readBlockedRaceState(fixture, matchId), {
          ...before,
          account: [{
            status: "blocked",
            wallet_coins: fixture.startingWalletCoins - fixture.entryCoins[0],
          }],
        }, "the retry must not change the existing registration, roster, wallet, or ledger");
      } finally {
        if (blockTransactionOpen) await blocker.query("ROLLBACK");
        connectionPause.release();
        connectionPause.restore();
        if (retry) await Promise.allSettled([retry]);
        blocker.release();
      }
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("a team edit authenticated before an account block cannot change the roster afterward", async () => {
  const fixture = await createFixture("duo", { entryCoins: [0, 0] });
  try {
    await withServer(async (origin) => {
      const matchId = fixture.matchIds[0];
      const initial = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[0],
        { teamName: fixture.teamNames[0], teammates: fixture.teammates[0] },
      );
      assert.equal(initial.status, 201, JSON.stringify(initial.body));
      const registrationId = String(initial.body.registrationId);
      const before = await readBlockedRaceState(fixture, matchId);
      assert.equal(before.registrations.length, 1);
      assert.equal(before.roster.length, 1);
      const response = await runAfterAuthenticationBlockRace(
        origin,
        fixture,
        matchId,
        "FROM daily007_v2_matches m",
        () => editTeam(origin, fixture.userId, registrationId, {
          captainGameName: "Blocked Edit Captain",
          captainGameUid: `ff-${randomUUID()}`,
          teamName: "Blocked Edit Squad",
          teammates: [{ name: "Blocked Edit Teammate", uid: `ff-${randomUUID()}` }],
        }),
      );
      assert.equal(response.status, 403, JSON.stringify(response.body));
      assert.deepEqual(response.body, { error: "This account is blocked." });
      assert.deepEqual(await readBlockedRaceState(fixture, matchId), {
        ...before,
        account: [{ status: "blocked", wallet_coins: fixture.startingWalletCoins }],
      });
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("an account block waits for a registration that already holds the account lock", async () => {
  const fixture = await createFixture("duo");
  let adminId: string | undefined;
  try {
    adminId = await createFullAdminActor();
    await withServer(async (origin) => {
      const matchId = fixture.matchIds[0];
      assert.deepEqual(await readBlockedRaceState(fixture, matchId), {
        account: [{ status: "active", wallet_coins: fixture.startingWalletCoins }],
        registrations: [],
        roster: [],
        ledger: [],
      });

      const { playerAction, accountBlock } = await runAccountBlockAfterPlayerActionLockRace(
        origin,
        fixture,
        adminId!,
        "registration",
        matchId,
        () => registerForMatch(
          origin,
          fixture.userId,
          matchId,
          fixture.gameUids[0],
          { teamName: fixture.teamNames[0], teammates: fixture.teammates[0] },
        ),
      );
      assert.equal(playerAction.status, 201, JSON.stringify(playerAction.body));
      assert.equal(accountBlock.status, 200, JSON.stringify(accountBlock.body));
      assert.equal(accountBlock.body.status, "blocked");

      const registrationId = String(playerAction.body.registrationId);
      const balanceAfterEntry = fixture.startingWalletCoins - fixture.entryCoins[0];
      const teammate = fixture.teammates[0][0]!;
      assert.deepEqual(await readBlockedRaceState(fixture, matchId), {
        account: [{ status: "blocked", wallet_coins: balanceAfterEntry }],
        registrations: [{
          id: registrationId,
          match_id: matchId,
          captain_user_id: fixture.userId,
          captain_name: "Wallet Race Player",
          captain_game_name: "Concurrent Test Player",
          captain_game_uid: fixture.gameUids[0],
          team_name: fixture.teamNames[0],
          entry_coins_paid: fixture.entryCoins[0],
          status: "approved",
        }],
        roster: [{
          registration_id: registrationId,
          position: 1,
          member_uid: teammate.uid,
          member_name: teammate.name,
        }],
        ledger: [{
          match_id: matchId,
          registration_id: registrationId,
          amount: -fixture.entryCoins[0],
          balance_after: balanceAfterEntry,
          reason: "match_entry",
        }],
      }, "the registration must finish consistently before the block commits");
    });
  } finally {
    try {
      await cleanupFixture(fixture);
    } finally {
      if (adminId) {
        await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
      }
    }
  }
});

test("an account block waits for a team edit that already holds the account lock", async () => {
  const fixture = await createFixture("duo");
  let adminId: string | undefined;
  try {
    adminId = await createFullAdminActor();
    await withServer(async (origin) => {
      const matchId = fixture.matchIds[0];
      const initial = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[0],
        { teamName: fixture.teamNames[0], teammates: fixture.teammates[0] },
      );
      assert.equal(initial.status, 201, JSON.stringify(initial.body));
      const registrationId = String(initial.body.registrationId);
      const before = await readBlockedRaceState(fixture, matchId);
      assert.equal(before.registrations.length, 1);
      assert.equal(before.roster.length, 1);
      assert.equal(before.ledger.length, 1);

      const changedTeammate = { name: "Committed Teammate", uid: `ff-${randomUUID()}` };
      const edit = {
        captainGameName: "Committed Captain",
        captainGameUid: `ff-${randomUUID()}`,
        teamName: "Committed Before Account Block",
        teammates: [changedTeammate],
        expectedTeam: {
          captainGameName: "Concurrent Test Player",
          captainGameUid: fixture.gameUids[0],
          teamName: fixture.teamNames[0],
          teammates: fixture.teammates[0].map(({ name, uid }) => ({ name, uid })),
        },
      };
      const { playerAction, accountBlock } = await runAccountBlockAfterPlayerActionLockRace(
        origin,
        fixture,
        adminId!,
        "team_edit",
        registrationId,
        () => editTeam(origin, fixture.userId, registrationId, edit),
      );
      assert.equal(playerAction.status, 200, JSON.stringify(playerAction.body));
      assert.equal(
        (playerAction.body.data as Record<string, unknown> | undefined)?.updated,
        true,
      );
      assert.equal(accountBlock.status, 200, JSON.stringify(accountBlock.body));
      assert.equal(accountBlock.body.status, "blocked");

      assert.deepEqual(await readBlockedRaceState(fixture, matchId), {
        ...before,
        account: [{ ...before.account[0]!, status: "blocked" }],
        registrations: [{
          ...before.registrations[0]!,
          captain_game_name: edit.captainGameName,
          captain_game_uid: edit.captainGameUid,
          team_name: edit.teamName,
        }],
        roster: [{
          registration_id: registrationId,
          position: 1,
          member_uid: changedTeammate.uid,
          member_name: changedTeammate.name,
        }],
      }, "the team edit must finish without changing the saved wallet or ledger before the block commits");
    });
  } finally {
    try {
      await cleanupFixture(fixture);
    } finally {
      if (adminId) {
        await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
      }
    }
  }
});

async function runConcurrentWalletRace(teamType: WalletRaceFixture["teamType"]): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture(teamType);
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
        registerForMatch(
          origin,
          fixture.userId,
          matchId,
          fixture.gameUids[index],
          teamType !== "solo"
            ? {
                teammates: fixture.teammates[index],
                teamName: fixture.teamNames[index],
              }
            : null,
        ),
      );

      try {
        await waitForBlockedRequests(
          blockerPid,
          2,
          "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
          "wallet",
        );
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
      assert.notEqual(fixture.entryCoins[0], fixture.entryCoins[1]);

      const registrations = await pool.query<{
        id: string;
        match_id: string;
        captain_user_id: string;
        captain_game_uid: string;
        team_name: string;
        entry_coins_paid: number;
        status: string;
        entry_coins: number;
      }>(
        `SELECT r.id, r.match_id, r.captain_user_id, r.captain_game_uid, r.team_name,
                r.entry_coins_paid, r.status, m.entry_coins
           FROM daily007_v2_registrations r
           JOIN daily007_v2_matches m ON m.id = r.match_id
          WHERE r.match_id = ANY($1::uuid[]) AND r.captain_user_id = $2
          ORDER BY r.match_id`,
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
        assert.equal(
          registration.team_name,
          teamType === "solo" ? "" : fixture.teamNames[index],
        );
        assert.equal(registration.entry_coins, fixture.entryCoins[index]);
        assert.equal(registration.entry_coins_paid, fixture.entryCoins[index]);
        assert.equal(registration.status, "approved");
        assert.equal(Number(responses[index].body.entryCoinsPaid), fixture.entryCoins[index]);
        assert.equal(responses[index].body.registrationId, registration.id);
      }

      const roster = await pool.query<{
        registration_id: string;
        match_id: string;
        position: number;
        member_uid: string | null;
        member_name: string;
      }>(
        `SELECT roster.registration_id, registration.match_id, roster.position,
                roster.member_uid, roster.member_name
           FROM daily007_v2_roster roster
           JOIN daily007_v2_registrations registration ON registration.id = roster.registration_id
          WHERE registration.match_id = ANY($1::uuid[]) AND registration.captain_user_id = $2
          ORDER BY registration.match_id, roster.position`,
        [fixture.matchIds, fixture.userId],
      );
      assert.equal(
        roster.rows.length,
        teamType === "solo" ? 0 : teamType === "duo" ? 2 : 6,
        teamType === "solo"
          ? "solo registrations must not create teammate rows"
          : teamType === "duo"
            ? "each duo registration must have exactly one teammate row"
            : "each squad registration must have exactly three teammate rows",
      );
      if (teamType !== "solo") {
        const allPlayerUids = [
          ...fixture.gameUids,
          ...fixture.teammates.flatMap((team) => team.map((teammate) => teammate.uid)),
        ];
        assert.equal(
          new Set(allPlayerUids).size,
          allPlayerUids.length,
          "every player across both tournament entries must have a unique game UID",
        );
        for (const [index, matchId] of fixture.matchIds.entries()) {
          const registration = registrations.rows.find((entry) => entry.match_id === matchId);
          assert.ok(registration, `registration for ${matchId} must exist`);
          const teammateRows = roster.rows.filter((row) => row.registration_id === registration.id);
          const expectedTeammates = fixture.teammates[index];
          assert.equal(
            teammateRows.length,
            teamType === "squad" ? 3 : 1,
            `registration for ${matchId} must own only its submitted teammates`,
          );
          assert.deepEqual(
            teammateRows.map(({ position, member_uid, member_name }) => ({
              position,
              member_uid,
              member_name,
            })),
            expectedTeammates.map((teammate, teammateIndex) => ({
              position: teammateIndex + 1,
              member_uid: teammate.uid,
              member_name: teammate.name,
            })),
            `registration for ${matchId} must retain its own teammates at their submitted positions`,
          );
          assert.ok(
            teammateRows.every((row) => row.match_id === matchId && row.registration_id === registration.id),
            `every teammate row for ${matchId} must remain attached to its own tournament registration`,
          );
        }
      }

      const expectedFinalBalance = fixture.startingWalletCoins -
        fixture.entryCoins.reduce((total, entryCoins) => total + entryCoins, 0);
      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      assert.deepEqual(
        wallet.rows,
        [{ wallet_coins: expectedFinalBalance }],
        "the player should pay exactly the two tournament-specific entry fees",
      );

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
      for (const entry of ledger.rows) {
        const matchIndex = fixture.matchIds.indexOf(entry.match_id);
        assert.ok(matchIndex >= 0, "each ledger entry must belong to one of the two tournaments");
        assert.equal(entry.amount, -fixture.entryCoins[matchIndex]);
        assert.equal(entry.reason, "match_entry");
        const registration = registrations.rows.find((row) => row.match_id === entry.match_id);
        assert.ok(registration);
        assert.equal(entry.registration_id, registration.id);
        assert.equal(entry.amount, -registration.entry_coins);
        assert.equal(entry.balance_after, Number(responses[matchIndex].body.walletCoins));
      }

      const [firstDebit, secondDebit] = [...ledger.rows]
        .sort((left, right) => right.balance_after - left.balance_after);
      assert.ok(firstDebit && secondDebit, "both serialized wallet debits must have ledger entries");
      assert.equal(
        firstDebit.balance_after - firstDebit.amount,
        fixture.startingWalletCoins,
        "the first ledger balance must start from the original wallet balance",
      );
      assert.equal(
        secondDebit.balance_after - secondDebit.amount,
        firstDebit.balance_after,
        "the second ledger balance must start from the first debit's balance",
      );
      assert.equal(
        secondDebit.balance_after,
        expectedFinalBalance,
        "the last ledger balance must match the final wallet balance",
      );
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
}

async function runConcurrentInsufficientBalanceRace(firstMatchIndex: 0 | 1): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  const submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture("solo", {
      entryCoins: [13, 17],
      startingWalletCoins: 20,
    });
    fixtureForCleanup = fixture;
    const secondMatchIndex = (1 - firstMatchIndex) as 0 | 1;
    const blocker = await pool.connect();
    blockerForCleanup = blocker;

    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [fixture.userId],
      );
      const blockerPid = await backendPid(blocker);

      const submit = (matchIndex: 0 | 1) =>
        registerForMatch(
          origin,
          fixture.userId,
          fixture.matchIds[matchIndex],
          fixture.gameUids[matchIndex],
          null,
        );
      submissions.push(submit(firstMatchIndex));
      await waitForBlockedRequests(
        blockerPid,
        1,
        "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        "wallet",
      );
      submissions.push(submit(secondMatchIndex));

      try {
        await waitForBlockedRequests(
          blockerPid,
          2,
          "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
          "wallet",
        );
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const [firstResponse, secondResponse] = await Promise.all(submissions);
      assert.equal(firstResponse.status, 201, JSON.stringify(firstResponse.body));
      assert.equal(firstResponse.body.entryCoinsPaid, fixture.entryCoins[firstMatchIndex]);
      assert.equal(
        firstResponse.body.walletCoins,
        fixture.startingWalletCoins - fixture.entryCoins[firstMatchIndex],
      );
      assert.equal(secondResponse.status, 409, JSON.stringify(secondResponse.body));
      assert.equal(secondResponse.body.code, "INSUFFICIENT_BALANCE");
      assert.equal(
        secondResponse.body.error,
        `Insufficient wallet balance: this entry costs ${fixture.entryCoins[secondMatchIndex]} coins.`,
      );

      const registrations = await pool.query<{
        id: string;
        match_id: string;
        entry_coins_paid: number;
        status: string;
      }>(
        `SELECT id, match_id, entry_coins_paid, status
           FROM daily007_v2_registrations
          WHERE match_id = ANY($1::uuid[]) AND captain_user_id = $2`,
        [fixture.matchIds, fixture.userId],
      );
      assert.equal(registrations.rows.length, 1, "only the successful tournament may have a registration");
      const registration = registrations.rows[0];
      assert.ok(registration);
      assert.equal(registration.match_id, fixture.matchIds[firstMatchIndex]);
      assert.equal(registration.entry_coins_paid, fixture.entryCoins[firstMatchIndex]);
      assert.equal(registration.status, "approved");
      assert.equal(firstResponse.body.registrationId, registration.id);
      assert.ok(
        !registrations.rows.some((row) => row.match_id === fixture.matchIds[secondMatchIndex]),
        "the rejected tournament must not retain a registration",
      );

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      const finalBalance = fixture.startingWalletCoins - fixture.entryCoins[firstMatchIndex];
      assert.deepEqual(wallet.rows, [{ wallet_coins: finalBalance }]);

      const ledger = await pool.query<{
        match_id: string;
        registration_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1 AND match_id = ANY($2::uuid[])`,
        [fixture.userId, fixture.matchIds],
      );
      assert.deepEqual(ledger.rows, [{
        match_id: fixture.matchIds[firstMatchIndex],
        registration_id: registration.id,
        amount: -fixture.entryCoins[firstMatchIndex],
        balance_after: finalBalance,
        reason: "match_entry",
      }], "exactly one debit must match the successful registration and final wallet balance");
      assert.ok(
        ledger.rows.every((entry) => entry.match_id !== fixture.matchIds[secondMatchIndex]),
        "the rejected tournament must not retain a debit",
      );
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
}

async function runConcurrentJoinWithdrawalRace(firstOperation: "join" | "withdrawal"): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  const submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture("solo", {
      entryCoins: [13, 0],
      startingWalletCoins: 110,
    });
    fixtureForCleanup = fixture;
    const joinMatchId = fixture.matchIds[0];
    await pool.query(
      `INSERT INTO daily007_v2_settings (id, settings)
       VALUES (1, '{"withdrawalEnabled":"true","minWithdrawal":"100","maxWithdrawal":"5000"}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET settings = daily007_v2_settings.settings ||
         '{"withdrawalEnabled":"true","minWithdrawal":"100","maxWithdrawal":"5000"}'::jsonb`,
    );

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

      const submitJoin = () => registerForMatch(
        origin,
        fixture.userId,
        joinMatchId,
        fixture.gameUids[0],
        null,
      );
      const submitWithdrawal = () => requestWithdrawal(origin, fixture.userId, 100);
      const firstSubmission = firstOperation === "join" ? submitJoin() : submitWithdrawal();
      submissions.push(firstSubmission);
      const walletLockQuery = "FROM daily007_v2_users WHERE id = $1 FOR UPDATE";
      await waitForBlockedRequests(blockerPid, 1, walletLockQuery, "wallet");

      const secondSubmission = firstOperation === "join" ? submitWithdrawal() : submitJoin();
      submissions.push(secondSubmission);
      try {
        await waitForBlockedRequests(blockerPid, 2, walletLockQuery, "wallet");
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const [firstResponse, secondResponse] = await Promise.all(submissions);
      assert.equal(firstResponse.status, 201, JSON.stringify(firstResponse.body));
      assert.equal(secondResponse.status, 409, JSON.stringify(secondResponse.body));
      if (firstOperation === "join") {
        assert.equal(firstResponse.body.entryCoinsPaid, 13);
        assert.equal(firstResponse.body.walletCoins, 97);
        assert.deepEqual(secondResponse.body, { error: "Insufficient wallet balance." });
      } else {
        assert.equal(firstResponse.body.coins, 100);
        assert.equal(firstResponse.body.walletCoins, 10);
        assert.deepEqual(secondResponse.body, {
          error: "Insufficient wallet balance: this entry costs 13 coins.",
          code: "INSUFFICIENT_BALANCE",
        });
      }

      const expectedWinnerBalance = firstOperation === "join" ? 97 : 10;
      const account = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      assert.deepEqual(account.rows, [{ wallet_coins: expectedWinnerBalance }]);

      const registrations = await pool.query<{
        id: string;
        match_id: string;
        entry_coins_paid: number;
        status: string;
      }>(
        `SELECT id, match_id, entry_coins_paid, status
           FROM daily007_v2_registrations
          WHERE captain_user_id = $1 AND match_id = $2`,
        [fixture.userId, joinMatchId],
      );
      const withdrawals = await pool.query<{ id: string; coins: number; status: string }>(
        `SELECT id, coins, status FROM daily007_v2_withdrawals WHERE user_id = $1`,
        [fixture.userId],
      );
      const ledger = await pool.query<{
        amount: number;
        balance_after: number;
        reason: string;
        match_id: string | null;
        registration_id: string | null;
      }>(
        `SELECT amount, balance_after, reason, match_id, registration_id
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY balance_after DESC`,
        [fixture.userId],
      );

      if (firstOperation === "join") {
        assert.equal(registrations.rows.length, 1);
        assert.equal(registrations.rows[0]?.match_id, joinMatchId);
        assert.equal(registrations.rows[0]?.entry_coins_paid, 13);
        assert.equal(registrations.rows[0]?.status, "approved");
        assert.equal(registrations.rows[0]?.id, firstResponse.body.registrationId);
        assert.deepEqual(withdrawals.rows, [], "the rejected withdrawal must not remain pending");
        assert.deepEqual(ledger.rows, [{
          amount: -13,
          balance_after: 97,
          reason: "match_entry",
          match_id: joinMatchId,
          registration_id: registrations.rows[0]?.id,
        }]);
      } else {
        assert.deepEqual(registrations.rows, [], "the rejected tournament join must leave no registration");
        assert.equal(withdrawals.rows.length, 1);
        assert.equal(withdrawals.rows[0]?.coins, 100);
        assert.equal(withdrawals.rows[0]?.status, "pending");
        assert.equal(withdrawals.rows[0]?.id, firstResponse.body.id);
        assert.deepEqual(ledger.rows, [{
          amount: -100,
          balance_after: 10,
          reason: "withdrawal_reserved",
          match_id: null,
          registration_id: null,
        }]);
      }
      assert.equal(ledger.rows.length, 1, "only the successful debit may have a ledger entry");
      assert.equal(ledger.rows[0]?.balance_after, expectedWinnerBalance);
      assert.equal(
        ledger.rows[0]?.balance_after - ledger.rows[0]?.amount,
        fixture.startingWalletCoins,
        "the successful debit's ledger balance must reconcile to the starting wallet",
      );
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
}

async function runConcurrentAdjustmentWithdrawalRace(
  firstOperation: "admin" | "withdrawal",
  adjustmentDelta = 40,
): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let adminId: string | undefined;
  const submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture("solo", { startingWalletCoins: 250 });
    fixtureForCleanup = fixture;
    adminId = await createFullAdminActor();
    await pool.query(
      `INSERT INTO daily007_v2_settings (id, settings)
       VALUES (1, '{"withdrawalEnabled":"true","minWithdrawal":"100","maxWithdrawal":"5000"}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET settings = daily007_v2_settings.settings ||
         '{"withdrawalEnabled":"true","minWithdrawal":"100","maxWithdrawal":"5000"}'::jsonb`,
    );

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
      const walletLockQuery = "FROM daily007_v2_users WHERE id = $1 FOR UPDATE";
      const submitAdjustment = () =>
        adjustWalletCoins(origin, adminId!, fixture.userId, adjustmentDelta);
      const submitWithdrawal = () => requestWithdrawal(origin, fixture.userId, 100);

      const firstSubmission = firstOperation === "admin" ? submitAdjustment() : submitWithdrawal();
      submissions.push(firstSubmission);
      await waitForBlockedRequests(blockerPid, 1, walletLockQuery, "wallet");

      const secondSubmission = firstOperation === "admin" ? submitWithdrawal() : submitAdjustment();
      submissions.push(secondSubmission);
      try {
        await waitForBlockedRequests(blockerPid, 2, walletLockQuery, "wallet");
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const [firstResponse, secondResponse] = await Promise.all(submissions);
      const adjustmentResponse = firstOperation === "admin" ? firstResponse : secondResponse;
      const withdrawalResponse = firstOperation === "admin" ? secondResponse : firstResponse;
      const withdrawalCanComplete =
        firstOperation === "admin" ? fixture.startingWalletCoins + adjustmentDelta >= 100 : true;
      const adjustmentCanComplete = firstOperation === "admin" || 150 + adjustmentDelta >= 0;
      const expectedFinalBalance = firstOperation === "admin"
        ? fixture.startingWalletCoins + adjustmentDelta - (withdrawalCanComplete ? 100 : 0)
        : 150 + (adjustmentCanComplete ? adjustmentDelta : 0);
      assert.equal(
        adjustmentResponse.status,
        adjustmentCanComplete ? 200 : 409,
        JSON.stringify(adjustmentResponse.body),
      );
      assert.equal(
        withdrawalResponse.status,
        withdrawalCanComplete ? 201 : 409,
        JSON.stringify(withdrawalResponse.body),
      );
      if (adjustmentCanComplete) {
        assert.equal(
          adjustmentResponse.body.coins,
          firstOperation === "admin"
            ? fixture.startingWalletCoins + adjustmentDelta
            : 150 + adjustmentDelta,
        );
      } else {
        assert.deepEqual(adjustmentResponse.body, {
          error: "Adjustment would make the wallet negative or exceed its supported range.",
        });
      }
      if (withdrawalCanComplete) {
        assert.equal(withdrawalResponse.body.coins, 100);
        assert.equal(
          withdrawalResponse.body.walletCoins,
          firstOperation === "admin" ? fixture.startingWalletCoins + adjustmentDelta - 100 : 150,
        );
      } else {
        assert.deepEqual(withdrawalResponse.body, { error: "Insufficient wallet balance." });
      }

      const account = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      assert.deepEqual(account.rows, [{ wallet_coins: expectedFinalBalance }]);

      const withdrawals = await pool.query<{
        id: string;
        coins: number;
        status: string;
      }>(
        `SELECT id, coins, status
           FROM daily007_v2_withdrawals
          WHERE user_id = $1`,
        [fixture.userId],
      );
      assert.deepEqual(
        withdrawals.rows,
        withdrawalCanComplete
          ? [{ id: withdrawalResponse.body.id, coins: 100, status: "pending" }]
          : [],
      );

      const ledger = await pool.query<{
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1
          ORDER BY created_at, id`,
        [fixture.userId],
      );
      const expectedLedger = firstOperation === "admin"
        ? [
            {
              amount: adjustmentDelta,
              balance_after: fixture.startingWalletCoins + adjustmentDelta,
              reason: "admin_adjustment:concurrent wallet adjustment",
            },
            ...(withdrawalCanComplete
              ? [{
                  amount: -100,
                  balance_after: fixture.startingWalletCoins + adjustmentDelta - 100,
                  reason: "withdrawal_reserved",
                }]
              : []),
          ]
        : [
            { amount: -100, balance_after: 150, reason: "withdrawal_reserved" },
            ...(adjustmentCanComplete
              ? [{
                  amount: adjustmentDelta,
                  balance_after: 150 + adjustmentDelta,
                  reason: "admin_adjustment:concurrent wallet adjustment",
                }]
              : []),
          ];
      assert.deepEqual(ledger.rows, expectedLedger);

      let expectedBalance = fixture.startingWalletCoins;
      for (const entry of ledger.rows) {
        expectedBalance += entry.amount;
        assert.equal(
          entry.balance_after,
          expectedBalance,
          "each ledger balance must continue from the prior balance in the observed lock order",
        );
      }
      assert.equal(expectedBalance, expectedFinalBalance);
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
      if (adminId) await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
    }
  }
}

async function runConcurrentDuoRetryRace(): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture("duo");
    fixtureForCleanup = fixture;
    const matchId = fixture.matchIds[0];
    const entryCoins = fixture.entryCoins[0];
    const blocker = await pool.connect();
    blockerForCleanup = blocker;

    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query("SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE", [matchId]);
      const blockerPid = await backendPid(blocker);

      const retryTeammates = [
        fixture.teammates[0][0]!,
        fixture.teammates[1][0]!,
      ];
      submissions = retryTeammates.map((teammate, index) =>
        registerForMatch(
          origin,
          fixture.userId,
          matchId,
          fixture.gameUids[0],
          {
            teamName: fixture.teamNames[index],
            teammates: [teammate],
          },
        ),
      );

      try {
        await waitForBlockedRequests(
          blockerPid,
          2,
          "FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
          "match",
        );
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
        responses.map((response) => response.status).sort(),
        [200, 201],
        `one retry must create the registration and the other must reuse it: ${JSON.stringify(responses)}`,
      );
      const winnerIndex = responses.findIndex((response) => response.body.alreadyRegistered === false);
      const retryIndex = responses.findIndex((response) => response.body.alreadyRegistered === true);
      assert.notEqual(winnerIndex, -1, "one response must identify the newly created registration");
      assert.notEqual(retryIndex, -1, "one response must identify the existing registration");
      assert.equal(responses[winnerIndex].status, 201);
      assert.equal(responses[retryIndex].status, 200);
      assert.notEqual(fixture.teamNames[0], fixture.teamNames[1]);
      assert.notEqual(retryTeammates[0].uid, retryTeammates[1].uid);

      const registrations = await pool.query<{
        id: string;
        team_name: string;
        entry_coins_paid: number;
        status: string;
      }>(
        `SELECT id, team_name, entry_coins_paid, status
           FROM daily007_v2_registrations
          WHERE match_id = $1 AND captain_user_id = $2`,
        [matchId, fixture.userId],
      );
      assert.equal(registrations.rows.length, 1, "a retry must not create a second registration");
      const registration = registrations.rows[0];
      assert.ok(registration);
      assert.equal(registration.team_name, fixture.teamNames[winnerIndex]);
      assert.equal(registration.entry_coins_paid, entryCoins);
      assert.equal(registration.status, "approved");
      assert.equal(responses[winnerIndex].body.registrationId, registration.id);
      assert.equal(responses[retryIndex].body.registrationId, registration.id);
      for (const response of responses) {
        assert.equal(response.body.entryCoinsPaid, entryCoins);
        assert.equal(response.body.walletCoins, fixture.startingWalletCoins - entryCoins);
      }

      const roster = await pool.query<{
        registration_id: string;
        position: number;
        member_uid: string | null;
        member_name: string;
      }>(
        `SELECT registration_id, position, member_uid, member_name
           FROM daily007_v2_roster
          WHERE registration_id = $1
          ORDER BY position`,
        [registration.id],
      );
      assert.deepEqual(
        roster.rows,
        [{
          registration_id: registration.id,
          position: 1,
          member_uid: retryTeammates[winnerIndex]!.uid,
          member_name: retryTeammates[winnerIndex]!.name,
        }],
        "the registration must retain only the teammate payload from the winning request",
      );

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      assert.deepEqual(
        wallet.rows,
        [{ wallet_coins: fixture.startingWalletCoins - entryCoins }],
        "a retried signup must debit the entry fee only once",
      );

      const ledger = await pool.query<{
        match_id: string;
        registration_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1 AND match_id = $2`,
        [fixture.userId, matchId],
      );
      assert.deepEqual(
        ledger.rows,
        [{
          match_id: matchId,
          registration_id: registration.id,
          amount: -entryCoins,
          balance_after: fixture.startingWalletCoins - entryCoins,
          reason: "match_entry",
        }],
        "there must be exactly one fee debit linked to the winning registration",
      );
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
}

async function readEntryPaymentState(fixture: WalletRaceFixture, matchId: string) {
  const [wallet, registrations, roster, ledger] = await Promise.all([
    pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.userId],
    ),
    pool.query<{ id: string; entry_coins_paid: number; status: string }>(
      `SELECT id, entry_coins_paid, status
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND captain_user_id = $2`,
      [matchId, fixture.userId],
    ),
    pool.query<{
      registration_id: string;
      position: number;
      member_uid: string | null;
      member_name: string;
    }>(
      `SELECT roster.registration_id, roster.position, roster.member_uid, roster.member_name
         FROM daily007_v2_roster AS roster
         JOIN daily007_v2_registrations AS registration ON registration.id = roster.registration_id
        WHERE registration.match_id = $1 AND registration.captain_user_id = $2
        ORDER BY roster.position`,
      [matchId, fixture.userId],
    ),
    pool.query<{
      registration_id: string;
      amount: number;
      balance_after: number;
      reason: string;
    }>(
      `SELECT registration_id, amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND match_id = $2`,
      [fixture.userId, matchId],
    ),
  ]);
  return {
    wallet: wallet.rows,
    registrations: registrations.rows,
    roster: roster.rows,
    ledger: ledger.rows,
  };
}

async function runClosedTeamRetry(matchState: "full" | "disabled"): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;

  try {
    const fixture = await createFixture("duo");
    fixtureForCleanup = fixture;
    const matchId = fixture.matchIds[0];
    const originalTeam = {
      teamName: fixture.teamNames[0],
      teammates: fixture.teammates[0],
    };
    const alternateTeam = {
      teamName: `Changed retry team ${randomUUID()}`,
      teammates: [{ name: `Changed teammate ${randomUUID()}`, uid: `ff-${randomUUID()}` }],
    };

    await withServer(async (origin) => {
      const created = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[0],
        originalTeam,
      );
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.alreadyRegistered, false);
      assert.equal(created.body.teamName, originalTeam.teamName);
      assert.deepEqual(created.body.teammates, originalTeam.teammates);
      const registrationId = created.body.registrationId;
      assert.equal(typeof registrationId, "string");

      const before = await readEntryPaymentState(fixture, matchId);
      await pool.query(
        `UPDATE daily007_v2_matches
            SET status = $2, is_full = $3, enabled = $4
          WHERE id = $1`,
        [
          matchId,
          matchState === "full" ? "full" : "open",
          matchState === "full",
          matchState !== "disabled",
        ],
      );

      const retried = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[1],
        alternateTeam,
        "Changed Retry Captain",
      );
      assert.equal(retried.status, 200, JSON.stringify(retried.body));
      assert.equal(retried.body.alreadyRegistered, true);
      assert.equal(retried.body.registrationId, registrationId);
      assert.equal(retried.body.captainGameName, "Concurrent Test Player");
      assert.equal(retried.body.captainGameUid, fixture.gameUids[0]);
      assert.equal(retried.body.teamName, originalTeam.teamName);
      assert.deepEqual(retried.body.teammates, originalTeam.teammates);

      const after = await readEntryPaymentState(fixture, matchId);
      assert.deepEqual(
        after,
        before,
        `retrying after the match became ${matchState} must not change the saved entry or wallet ledger`,
      );
      assert.deepEqual(after.wallet, [{
        wallet_coins: fixture.startingWalletCoins - fixture.entryCoins[0],
      }]);
      assert.equal(after.registrations.length, 1);
      assert.equal(after.registrations[0]?.id, registrationId);
      assert.equal(after.ledger.length, 1);
      assert.equal(after.ledger[0]?.amount, -fixture.entryCoins[0]);
    });
  } finally {
    if (fixtureForCleanup) await cleanupFixture(fixtureForCleanup);
  }
}

test("a failed entry-fee ledger insert rolls back the wallet, registration, and roster", async () => {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let failureConstraint: string | undefined;
  let failureConstraintInstalled = false;

  try {
    const fixture = await createFixture("duo", {
      entryCoins: [13, 17],
      startingWalletCoins: 50,
    });
    fixtureForCleanup = fixture;
    const matchId = fixture.matchIds[0];

    const before = await readEntryPaymentState(fixture, matchId);
    assert.deepEqual(before, {
      wallet: [{ wallet_coins: fixture.startingWalletCoins }],
      registrations: [],
      roster: [],
      ledger: [],
    });

    const constraintName = `daily007_test_reject_entry_${matchId.replace(/-/g, "")}`;
    failureConstraint = constraintName;
    await pool.query(
      `ALTER TABLE daily007_v2_wallet_ledger
         ADD CONSTRAINT "${constraintName}"
         CHECK (NOT (
           user_id = '${fixture.userId}'::uuid
           AND match_id = '${matchId}'::uuid
           AND reason = 'match_entry'
         ))`,
    );
    failureConstraintInstalled = true;

    await withServer(async (origin) => {
      const response = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[0],
        {
          teamName: fixture.teamNames[0],
          teammates: fixture.teammates[0],
        },
      );
      assert.equal(response.status, 500, JSON.stringify(response.body));
      assert.ok(
        typeof response.body.detail === "string" &&
          response.body.detail.includes(constraintName),
        "the scoped ledger failure constraint must reject the entry-fee history insert",
      );
    });

    const after = await readEntryPaymentState(fixture, matchId);
    assert.deepEqual(after, before, "every entry side effect must be rolled back when ledger history fails");
  } finally {
    try {
      if (failureConstraintInstalled && failureConstraint) {
        await pool.query(
          `ALTER TABLE daily007_v2_wallet_ledger DROP CONSTRAINT IF EXISTS "${failureConstraint}"`,
        );
      }
    } finally {
      if (fixtureForCleanup) await cleanupFixture(fixtureForCleanup);
    }
  }
});

test("concurrent solo joins charge each tournament's own fee", () => runConcurrentWalletRace("solo"));

test("concurrent duo joins keep fees and teammate rosters matched to each tournament", () =>
  runConcurrentWalletRace("duo"));

test("concurrent squad joins keep every player, position, and fee matched to its tournament", () =>
  runConcurrentWalletRace("squad"));

test("a fee update and valid join use the fee from the match row's lock order", async () => {
  await runEntryFeeChangeRace("admin");
  await runEntryFeeChangeRace("join");
});

test("an underfunded join queued behind a fee increase reports the new fee without payment writes", async () => {
  await runEntryFeeChangeRace("admin", { startingWalletCoins: 15 });
});

test("a 20-coin wallet accepts only the first 13- or 17-coin join in either lock order", async () => {
  await runConcurrentInsufficientBalanceRace(0);
  await runConcurrentInsufficientBalanceRace(1);
});

test("a 110-coin wallet cannot fund a 13-coin join and 100-coin withdrawal in either lock order", async () => {
  await runConcurrentJoinWithdrawalRace("join");
  await runConcurrentJoinWithdrawalRace("withdrawal");
});

test("an Admin coin adjustment and a withdrawal preserve the wallet balance chain in either lock order", async () => {
  await runConcurrentAdjustmentWithdrawalRace("admin");
  await runConcurrentAdjustmentWithdrawalRace("withdrawal");
  await runConcurrentAdjustmentWithdrawalRace("admin", -200);
});

test("concurrent duo retries keep one registration, fee debit, and winning teammate roster", () =>
  runConcurrentDuoRetryRace());

test("a full tournament retry returns the saved team entry without charging again", () =>
  runClosedTeamRetry("full"));

test("a disabled tournament retry returns the saved team entry without charging again", () =>
  runClosedTeamRetry("disabled"));

test("a player can retry the same tournament after an insufficient-balance rejection", async () => {
  const fixture = await createFixture("solo", {
    entryCoins: [13, 17],
    startingWalletCoins: 0,
  });
  try {
    const matchId = fixture.matchIds[0];
    await withServer(async (origin) => {
      const rejected = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[0],
        null,
      );
      assert.equal(rejected.status, 409, JSON.stringify(rejected.body));
      assert.deepEqual(rejected.body, {
        error: "Insufficient wallet balance: this entry costs 13 coins.",
        code: "INSUFFICIENT_BALANCE",
      });
      assert.deepEqual(await readEntryPaymentState(fixture, matchId), {
        wallet: [{ wallet_coins: 0 }],
        registrations: [],
        roster: [],
        ledger: [],
      }, "the rejected join must leave no persisted registration, roster, or debit");

      await pool.query(
        "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
        [fixture.userId, fixture.entryCoins[0]],
      );

      const retried = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[0],
        null,
      );
      assert.equal(retried.status, 201, JSON.stringify(retried.body));
      assert.equal(retried.body.alreadyRegistered, false);
      assert.equal(retried.body.status, "approved");
      assert.equal(retried.body.entryCoinsPaid, fixture.entryCoins[0]);
      assert.equal(retried.body.walletCoins, 0);

      const registrationId = retried.body.registrationId;
      assert.equal(typeof registrationId, "string");
      assert.deepEqual(await readEntryPaymentState(fixture, matchId), {
        wallet: [{ wallet_coins: 0 }],
        registrations: [{
          id: registrationId,
          entry_coins_paid: fixture.entryCoins[0],
          status: "approved",
        }],
        roster: [],
        ledger: [{
          registration_id: registrationId,
          amount: -fixture.entryCoins[0],
          balance_after: 0,
          reason: "match_entry",
        }],
      }, "the retry must create one approved entry and one debit linked to it");

      const linkedLedger = await pool.query<{
        match_id: string;
        registration_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1 AND match_id = $2`,
        [fixture.userId, matchId],
      );
      assert.deepEqual(linkedLedger.rows, [{
        match_id: matchId,
        registration_id: registrationId,
        amount: -fixture.entryCoins[0],
        balance_after: 0,
        reason: "match_entry",
      }]);
    });
  } finally {
    await cleanupFixture(fixture);
  }
});
