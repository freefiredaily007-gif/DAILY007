import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-team-edit-rollback-postgres-test-secret";
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

const FAILURE_SEQUENCE = "daily007_team_edit_roster_insert_attempts";
const FAILURE_FUNCTION = "daily007_fail_team_edit_roster_insert";
const FAILURE_TRIGGER = "daily007_fail_team_edit_roster_insert";
const ENTRY_COINS = 7;
const STARTING_WALLET_COINS = 100;

type TeamEditFixture = {
  playerId: string;
  matchId: string;
  profileName: string;
  captainGameName: string;
  captainGameUid: string;
  teamName: string;
  teammates: { name: string; uid: string }[];
};

type TeamEditPayload = {
  captainGameName: string;
  captainGameUid: string;
  teamName: string;
  teammates: { name: string; uid: string }[];
};

type RegistrationResponse = {
  status: number;
  body: Record<string, unknown>;
};

type DatabaseSnapshot = {
  profile: { id: string; name: string; wallet_coins: number } | undefined;
  registration: {
    id: string;
    match_id: string;
    captain_user_id: string;
    captain_name: string;
    captain_game_name: string;
    captain_game_uid: string;
    team_name: string;
    entry_coins_paid: number;
    status: string;
  } | undefined;
  roster: {
    id: string;
    registration_id: string;
    position: number;
    member_uid: string | null;
    member_name: string;
  }[];
  ledger: {
    id: string;
    user_id: string;
    amount: number;
    balance_after: number;
    reason: string;
    match_id: string | null;
    registration_id: string | null;
    idempotency_key: string | null;
    details: Record<string, unknown> | null;
  }[];
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
  app.use(daily007CompatCoreRouter);
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

function authHeaders(playerId: string): Record<string, string> {
  const token = makeToken(playerId, 0);
  assert.ok(token, "The isolated test player must receive a Daily007 session token.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function createFixture(): Promise<TeamEditFixture> {
  const fixture: TeamEditFixture = {
    playerId: randomUUID(),
    matchId: randomUUID(),
    profileName: "Original Daily007 Profile",
    captainGameName: "Original Fire Captain",
    captainGameUid: `ff-${randomUUID()}`,
    teamName: "Original Fire Squad",
    teammates: [
      { name: "Original Mate North", uid: `ff-${randomUUID()}` },
      { name: "Original Mate East", uid: `ff-${randomUUID()}` },
      { name: "Original Mate West", uid: `ff-${randomUUID()}` },
    ],
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, $2, $3, 'test-salt', 'test-hash', $4)`,
      [
        fixture.playerId,
        fixture.profileName,
        `player-${fixture.playerId}@example.test`,
        STARTING_WALLET_COINS,
      ],
    );
    await client.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, game_mode, team_type, capacity, entry_coins, starts_at, status, is_full)
       VALUES ($1, 'Team Edit Rollback Test', 'squad', 'battle_royale', 'squad',
               12, $2, now() + interval '2 days', 'open', false)`,
      [fixture.matchId, ENTRY_COINS],
    );
    await client.query("COMMIT");
    return fixture;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function registerTeam(
  origin: string,
  fixture: TeamEditFixture,
): Promise<RegistrationResponse> {
  const response = await fetch(
    `${origin}/daily007/v2/matches/${fixture.matchId}/register`,
    {
      method: "POST",
      headers: authHeaders(fixture.playerId),
      body: JSON.stringify({
        captainGameName: fixture.captainGameName,
        captainGameUid: fixture.captainGameUid,
        teamName: fixture.teamName,
        teammates: fixture.teammates,
      }),
    },
  );
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function editTeam(
  origin: string,
  playerId: string,
  registrationId: string,
  payload: TeamEditPayload = {
    captainGameName: "Updated Fire Captain",
    captainGameUid: `ff-${randomUUID()}`,
    teamName: "Updated Fire Squad",
    teammates: [
      { name: "Updated Mate North", uid: `ff-${randomUUID()}` },
      { name: "Updated Mate East", uid: `ff-${randomUUID()}` },
      { name: "Updated Mate West", uid: `ff-${randomUUID()}` },
    ],
  },
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/my/registrations/${registrationId}/team`, {
    method: "PATCH",
    headers: authHeaders(playerId),
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => ({})) as Record<string, unknown>,
  };
}

async function waitForBlockedRequest(
  queryFragment: string,
  expectedBlockerPid: number,
  description: string,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query ILIKE $1`,
      [`%${queryFragment}%`],
    );
    const waiter = result.rows.find((row) =>
      row.blockers.map(Number).includes(expectedBlockerPid),
    );
    if (waiter) return Number(waiter.pid);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description} to block in PostgreSQL.`);
}

async function snapshot(
  fixture: TeamEditFixture,
  registrationId: string,
): Promise<DatabaseSnapshot> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const profile = await client.query<DatabaseSnapshot["profile"]>(
      "SELECT id, name, wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.playerId],
    );
    const registration = await client.query<DatabaseSnapshot["registration"]>(
      `SELECT id, match_id, captain_user_id, captain_name, captain_game_name,
              captain_game_uid, team_name, entry_coins_paid, status
         FROM daily007_v2_registrations
        WHERE id = $1 AND match_id = $2`,
      [registrationId, fixture.matchId],
    );
    const roster = await client.query<DatabaseSnapshot["roster"][number]>(
      `SELECT id, registration_id, position, member_uid, member_name
         FROM daily007_v2_roster
        WHERE registration_id = $1
        ORDER BY position`,
      [registrationId],
    );
    const ledger = await client.query<DatabaseSnapshot["ledger"][number]>(
      `SELECT id, user_id, amount, balance_after, reason, match_id, registration_id,
              idempotency_key, details
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND match_id = $2
        ORDER BY id`,
      [fixture.playerId, fixture.matchId],
    );
    await client.query("COMMIT");
    return {
      profile: profile.rows[0],
      registration: registration.rows[0],
      roster: roster.rows,
      ledger: ledger.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function installRosterInsertFailure(): Promise<void> {
  await pool.query(`CREATE SEQUENCE ${FAILURE_SEQUENCE}`);
  await pool.query(`
    CREATE FUNCTION ${FAILURE_FUNCTION}() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      PERFORM nextval('${FAILURE_SEQUENCE}');
      IF NEW.position = 2 THEN
        RAISE EXCEPTION 'injected team edit failure at replacement roster position 2';
      END IF;
      RETURN NEW;
    END;
    $function$
  `);
  await pool.query(`
    CREATE TRIGGER ${FAILURE_TRIGGER}
    BEFORE INSERT ON daily007_v2_roster
    FOR EACH ROW EXECUTE FUNCTION ${FAILURE_FUNCTION}()
  `);
}

async function removeRosterInsertFailure(): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS ${FAILURE_TRIGGER} ON daily007_v2_roster`);
  await pool.query(`DROP FUNCTION IF EXISTS ${FAILURE_FUNCTION}()`);
  await pool.query(`DROP SEQUENCE IF EXISTS ${FAILURE_SEQUENCE}`);
}

async function cleanupFixture(fixture: TeamEditFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1 OR match_id = $2",
      [fixture.playerId, fixture.matchId],
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
    await client.query("DELETE FROM daily007_v2_users WHERE id = $1", [fixture.playerId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("a PostgreSQL roster insert failure preserves the last saved team, profile, payment, wallet, and ledger", async () => {
  const fixture = await createFixture();
  let registrationId: string | undefined;
  try {
    await withServer(async (origin) => {
      const registered = await registerTeam(origin, fixture);
      assert.equal(
        registered.status,
        201,
        `expected the original Squad registration to succeed: ${JSON.stringify(registered.body)}`,
      );
      assert.equal(typeof registered.body.registrationId, "string");
      registrationId = registered.body.registrationId as string;

      const initial = await snapshot(fixture, registrationId);
      assert.equal(initial.profile?.name, fixture.profileName);
      assert.equal(initial.profile?.wallet_coins, STARTING_WALLET_COINS - ENTRY_COINS);
      assert.equal(initial.registration?.captain_name, fixture.profileName);
      assert.equal(initial.registration?.entry_coins_paid, ENTRY_COINS);
      assert.equal(initial.roster.length, 3);
      assert.equal(initial.ledger.length, 1);
      assert.equal(initial.ledger[0]?.amount, -ENTRY_COINS);

      const successfulEdit = await editTeam(origin, fixture.playerId, registrationId);
      assert.equal(
        successfulEdit.status,
        200,
        `expected a valid team edit to succeed before fault injection: ${JSON.stringify(successfulEdit.body)}`,
      );
      const beforeFailure = await snapshot(fixture, registrationId);
      assert.equal(beforeFailure.profile?.name, fixture.profileName);
      assert.equal(beforeFailure.profile?.wallet_coins, STARTING_WALLET_COINS - ENTRY_COINS);
      assert.equal(beforeFailure.registration?.captain_name, fixture.profileName);
      assert.equal(beforeFailure.registration?.entry_coins_paid, ENTRY_COINS);
      assert.equal(beforeFailure.roster.length, 3);
      assert.equal(beforeFailure.ledger.length, 1);
      assert.equal(beforeFailure.ledger[0]?.amount, -ENTRY_COINS);

      await installRosterInsertFailure();
      const failedEdit = await editTeam(origin, fixture.playerId, registrationId);
      assert.equal(failedEdit.status, 500);
      assert.match(
        String(failedEdit.body.detail),
        /injected team edit failure at replacement roster position 2/,
      );

      const evidence = await pool.query<{ last_value: string; is_called: boolean }>(
        `SELECT last_value, is_called FROM ${FAILURE_SEQUENCE}`,
      );
      assert.equal(Number(evidence.rows[0]?.last_value), 2);
      assert.equal(evidence.rows[0]?.is_called, true);

      const after = await snapshot(fixture, registrationId);
      assert.deepEqual(
        after,
        beforeFailure,
        "fresh PostgreSQL reads must show that the failed edit changed none of the last saved state",
      );
    });
  } finally {
    await removeRosterInsertFailure();
    await cleanupFixture(fixture);
  }
});

test("concurrent PostgreSQL team edits keep captain and teammate details from one save together", async () => {
  const fixture = await createFixture();
  let registrationId: string | undefined;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  const edits: Promise<RegistrationResponse>[] = [];
  try {
    await withServer(async (origin) => {
      const registered = await registerTeam(origin, fixture);
      assert.equal(
        registered.status,
        201,
        `expected the original Squad registration to succeed: ${JSON.stringify(registered.body)}`,
      );
      assert.equal(typeof registered.body.registrationId, "string");
      registrationId = registered.body.registrationId as string;
      const initial = await snapshot(fixture, registrationId);
      assert.equal(initial.profile?.name, fixture.profileName);
      assert.equal(initial.profile?.wallet_coins, STARTING_WALLET_COINS - ENTRY_COINS);
      assert.equal(initial.registration?.entry_coins_paid, ENTRY_COINS);
      assert.equal(initial.ledger.length, 1);

      const firstEdit: TeamEditPayload = {
        captainGameName: "First Race Captain",
        captainGameUid: `ff-${randomUUID()}`,
        teamName: "First Race Squad",
        teammates: [
          { name: "First Race North", uid: `ff-${randomUUID()}` },
          { name: "First Race East", uid: `ff-${randomUUID()}` },
          { name: "First Race West", uid: `ff-${randomUUID()}` },
        ],
      };
      const secondEdit: TeamEditPayload = {
        captainGameName: "Second Race Captain",
        captainGameUid: `ff-${randomUUID()}`,
        teamName: "Second Race Squad",
        teammates: [
          { name: "Second Race North", uid: `ff-${randomUUID()}` },
          { name: "Second Race East", uid: `ff-${randomUUID()}` },
          { name: "Second Race West", uid: `ff-${randomUUID()}` },
        ],
      };

      blocker = await pool.connect();
      assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the blocker backend PID");
      const blockerPid = blocker.processID;
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT id FROM daily007_v2_registrations WHERE id = $1 FOR UPDATE",
        [registrationId],
      );

      edits.push(editTeam(origin, fixture.playerId, registrationId, firstEdit));
      const firstWaiterPid = await waitForBlockedRequest(
        "FROM daily007_v2_registrations",
        blockerPid,
        "the first team edit's registration-row lock",
      );

      edits.push(editTeam(origin, fixture.playerId, registrationId, secondEdit));
      await waitForBlockedRequest(
        "FROM daily007_v2_matches m",
        firstWaiterPid,
        "the second team edit's match-row lock behind the first edit",
      );

      await blocker.query("COMMIT");
      blockerTransactionOpen = false;
      const results = await Promise.all(edits);
      assert.deepEqual(
        results.map((result) => result.status),
        [200, 200],
        `both valid team edits should succeed: ${JSON.stringify(results.map((result) => result.body))}`,
      );

      const after = await snapshot(fixture, registrationId);
      const savedTeam = {
        captainGameName: after.registration?.captain_game_name,
        captainGameUid: after.registration?.captain_game_uid,
        teamName: after.registration?.team_name,
        teammates: after.roster.map((member) => ({ name: member.member_name, uid: member.member_uid })),
      };
      const asSavedShape = (edit: TeamEditPayload) => ({
        captainGameName: edit.captainGameName,
        captainGameUid: edit.captainGameUid,
        teamName: edit.teamName,
        teammates: edit.teammates,
      });
      assert.ok(
        JSON.stringify(savedTeam) === JSON.stringify(asSavedShape(firstEdit)) ||
          JSON.stringify(savedTeam) === JSON.stringify(asSavedShape(secondEdit)),
        `fresh reads must contain one complete edit, not mixed captain and teammate details: ${JSON.stringify(savedTeam)}`,
      );
      assert.equal(after.profile?.name, fixture.profileName);
      assert.equal(after.profile?.wallet_coins, STARTING_WALLET_COINS - ENTRY_COINS);
      assert.equal(after.registration?.captain_name, fixture.profileName);
      assert.equal(after.registration?.entry_coins_paid, ENTRY_COINS);
      assert.deepEqual(after.ledger, initial.ledger);
    });
  } finally {
    if (blockerTransactionOpen && blocker) await blocker.query("ROLLBACK");
    await Promise.allSettled(edits);
    blocker?.release();
    await cleanupFixture(fixture);
  }
});

test("registration and team edits cannot commit after PostgreSQL blocks the account", async () => {
  const registrationFixture = await createFixture();
  const teamEditFixture = await createFixture();
  const pendingRequests: Promise<RegistrationResponse>[] = [];
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let registrationId: string | undefined;

  try {
    blocker = await pool.connect();
    assert.ok(Number.isInteger(blocker.processID), "PostgreSQL should expose the blocker backend PID");
    const blockerPid = blocker.processID;

    await withServer(async (origin) => {
      await blocker!.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker!.query(
        `UPDATE daily007_v2_users
            SET status = 'blocked', auth_version = auth_version + 1
          WHERE id = $1`,
        [registrationFixture.playerId],
      );
      const registrationRequest = registerTeam(origin, registrationFixture);
      pendingRequests.push(registrationRequest);
      await waitForBlockedRequest(
        "SELECT wallet_coins, status FROM daily007_v2_users",
        blockerPid,
        "the registration's locked account check",
      );
      await blocker!.query("COMMIT");
      blockerTransactionOpen = false;

      const rejectedRegistration = await registrationRequest;
      assert.equal(
        rejectedRegistration.status,
        403,
        `a queued registration must be rejected after the account is blocked: ${JSON.stringify(rejectedRegistration.body)}`,
      );
      const registrationState = await pool.query<{ count: string; wallet_coins: number; ledger_count: string }>(
        `SELECT (SELECT count(*) FROM daily007_v2_registrations WHERE match_id = $1)::text AS count,
                u.wallet_coins,
                (SELECT count(*) FROM daily007_v2_wallet_ledger
                  WHERE user_id = $2 AND match_id = $1)::text AS ledger_count
           FROM daily007_v2_users u WHERE u.id = $2`,
        [registrationFixture.matchId, registrationFixture.playerId],
      );
      assert.equal(registrationState.rows[0]?.count, "0");
      assert.equal(registrationState.rows[0]?.wallet_coins, STARTING_WALLET_COINS);
      assert.equal(registrationState.rows[0]?.ledger_count, "0");

      const registered = await registerTeam(origin, teamEditFixture);
      assert.equal(
        registered.status,
        201,
        `the fixture team registration should succeed: ${JSON.stringify(registered.body)}`,
      );
      registrationId = registered.body.registrationId as string;
      assert.ok(registrationId);
      const beforeEdit = await snapshot(teamEditFixture, registrationId);

      await blocker!.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker!.query(
        `UPDATE daily007_v2_users
            SET status = 'blocked', auth_version = auth_version + 1
          WHERE id = $1`,
        [teamEditFixture.playerId],
      );
      const editRequest = editTeam(origin, teamEditFixture.playerId, registrationId);
      pendingRequests.push(editRequest);
      await waitForBlockedRequest(
        "SELECT status FROM daily007_v2_users WHERE id = $1 FOR SHARE",
        blockerPid,
        "the team edit's locked account check",
      );
      await blocker!.query("COMMIT");
      blockerTransactionOpen = false;

      const rejectedEdit = await editRequest;
      assert.equal(
        rejectedEdit.status,
        403,
        `a queued team edit must be rejected after the account is blocked: ${JSON.stringify(rejectedEdit.body)}`,
      );
      assert.deepEqual(
        await snapshot(teamEditFixture, registrationId),
        beforeEdit,
        "blocked team edits must leave the last saved registration and roster unchanged",
      );
    });
  } finally {
    if (blockerTransactionOpen && blocker) await blocker.query("ROLLBACK");
    await Promise.allSettled(pendingRequests);
    blocker?.release();
    await cleanupFixture(registrationFixture);
    await cleanupFixture(teamEditFixture);
  }
});
