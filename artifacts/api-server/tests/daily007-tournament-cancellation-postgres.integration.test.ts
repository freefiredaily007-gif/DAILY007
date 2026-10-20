import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import { makeToken } from "../src/lib/daily007-session-token";
import { runDaily007AutoCancellationSweep } from "../src/lib/daily007-tournament-auto-cancel";
import {
  cancelUnderfilledTournamentAndRefund,
  TournamentCancellationError,
} from "../src/lib/daily007-tournament-cancellation";

const testDatabaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const testDatabasePort = process.env.DAILY007_TEST_POSTGRES_PORT;
const TEST_AUTH_SECRET = "daily007-cancelled-room-privacy-postgres-test-secret";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

if (
  process.env.DAILY007_ISOLATED_POSTGRES_TEST !== "1" ||
  !testDatabaseUrl ||
  testDatabaseUrl.hostname !== "127.0.0.1" ||
  testDatabaseUrl.pathname !== "/postgres" ||
  testDatabaseUrl.port !== testDatabasePort
) {
  throw new Error("This integration test must run through the isolated PostgreSQL test runner.");
}

type CancellationResult = Awaited<ReturnType<typeof cancelUnderfilledTournamentAndRefund>>;
type CancellationOutcome =
  | { status: "fulfilled"; value: CancellationResult }
  | { status: "rejected"; reason: unknown };

type CancellationFixture = {
  matchIds: [string, string];
  payerIds: [string, string, string];
  registrationIds: [string, string, string];
};

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withCompatServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007CompatCoreRouter);

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

async function getMyRegistrations(origin: string, token: string): Promise<{
  status: number;
  body: any;
}> {
  const response = await fetch(`${origin}/my/registrations`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

async function createFixture(): Promise<CancellationFixture> {
  const fixture: CancellationFixture = {
    matchIds: [randomUUID(), randomUUID()],
    payerIds: [randomUUID(), randomUUID(), randomUUID()],
    registrationIds: [randomUUID(), randomUUID(), randomUUID()],
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [index, payerId] of fixture.payerIds.entries()) {
      await client.query(
        `INSERT INTO daily007_v2_users
           (id, name, email, password_salt, password_hash, wallet_coins)
         VALUES ($1, $2, $3, 'test-salt', 'test-hash', $4)`,
        [
          payerId,
          `Cancellation Concurrency Player ${index + 1}`,
          `cancellation-player-${payerId}@example.test`,
          [100, 200, 300][index],
        ],
      );
    }

    for (const [index, matchId] of fixture.matchIds.entries()) {
      await client.query(
        `INSERT INTO daily007_v2_matches
           (id, title, mode, game_mode, team_type, capacity, starts_at, status,
            enabled, is_full, room_id, room_password, room_published)
         VALUES ($1, $2, 'clash', 'clash_squad', 'solo', $3,
                 now() - interval '1 hour', 'open', true, false, $4, $5, true)`,
        [
          matchId,
          `Cancellation Concurrency Tournament ${index + 1}`,
          index === 0 ? 3 : 2,
          `room-${index + 1}`,
          `password-${index + 1}`,
        ],
      );
    }

    const registrations = [
      { index: 0, matchIndex: 0, payerIndex: 0, fee: 25, status: "approved" },
      { index: 1, matchIndex: 0, payerIndex: 1, fee: 40, status: "pending" },
      { index: 2, matchIndex: 1, payerIndex: 2, fee: 35, status: "approved" },
    ];
    for (const registration of registrations) {
      const { index, matchIndex, payerIndex, fee, status } = registration;
      const payerId = fixture.payerIds[payerIndex];
      await client.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, captain_name, captain_game_name,
            captain_game_uid, team_name, entry_coins_paid, status)
         VALUES ($1, $2, $3, $4, 'Cancellation Tester', $5, '', $6, $7)`,
        [
          fixture.registrationIds[index],
          fixture.matchIds[matchIndex],
          payerId,
          `Cancellation Player ${index + 1}`,
          `uid-${payerId}`,
          fee,
          status,
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

async function cleanupFixture(fixture: CancellationFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE match_id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_registrations WHERE id = ANY($1::uuid[])",
      [fixture.registrationIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("cancelled registrations stay visible without retained PostgreSQL room credentials", async () => {
  const fixture = await createFixture();
  const registrationId = fixture.registrationIds[0];
  const playerId = fixture.payerIds[0];
  const matchId = fixture.matchIds[0];
  const retainedRoomValues = {
    roomId: "CANCELLED-FIXTURE-ROOM-ID-DO-NOT-EXPOSE",
    roomPassword: "CANCELLED-FIXTURE-ROOM-PASSWORD-DO-NOT-EXPOSE",
    roomTime: "CANCELLED-FIXTURE-ROOM-TIME-DO-NOT-EXPOSE",
  };

  try {
    await pool.query(
      `UPDATE daily007_v2_matches
          SET status = 'cancelled', enabled = false, room_id = $2, room_password = $3, room_time = $4
        WHERE id = $1`,
      [matchId, retainedRoomValues.roomId, retainedRoomValues.roomPassword, retainedRoomValues.roomTime],
    );

    const storedMatch = await pool.query<{
      status: string;
      room_id: string;
      room_password: string;
      room_time: string;
    }>(
      "SELECT status, room_id, room_password, room_time FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(storedMatch.rows[0], {
      status: "cancelled",
      room_id: retainedRoomValues.roomId,
      room_password: retainedRoomValues.roomPassword,
      room_time: retainedRoomValues.roomTime,
    });

    const token = makeToken(playerId, 0);
    assert.ok(token, "The isolated test should create a valid Daily007 bearer token.");

    await withCompatServer(async (origin) => {
      const response = await getMyRegistrations(origin, token);
      assert.equal(response.status, 200);
      assert.ok(Array.isArray(response.body));

      const registration = response.body.find((entry: { id?: string }) => entry.id === registrationId);
      assert.ok(registration, "The approved registration should remain in the player's history.");
      assert.equal(registration.status, "approved");
      assert.equal(registration.tournament.id, matchId);
      assert.equal(registration.tournament.name, "Cancellation Concurrency Tournament 1");
      assert.equal(registration.tournament.status, "cancelled");

      for (const field of ["roomId", "roomPassword", "roomTime"]) {
        assert.equal(field in registration, false, `${field} must be omitted from the registration response.`);
        assert.equal(
          field in registration.tournament,
          false,
          `${field} must be omitted from the nested cancelled tournament.`,
        );
      }

      const serializedResponse = JSON.stringify(response.body);
      for (const value of Object.values(retainedRoomValues)) {
        assert.equal(
          serializedResponse.includes(value),
          false,
          "No retained room credential or time may appear anywhere in the serialized response.",
        );
      }
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

async function backendPid(client: Awaited<ReturnType<typeof pool.connect>>): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = result.rows[0]?.pid;
  assert.ok(pid, "PostgreSQL must provide a backend id for the lock holder.");
  return Number(pid);
}

async function waitForBlockedCancellation(blockerPid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query ILIKE $1`,
      ["%FOR UPDATE OF m%"],
    );
    const blocked = result.rows.find((row) =>
      row.blockers.map(Number).includes(blockerPid),
    );
    if (blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for PostgreSQL to block the held tournament cancellation.");
}

async function waitForPausedRefundWrite(timeoutMs = 5_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number }>(
      `SELECT pid
         FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE $1`,
      ["%INSERT INTO daily007_v2_wallet_ledger%"],
    );
    const pid = result.rows[0]?.pid;
    if (pid) return Number(pid);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the first cancellation refund write to pause.");
}

function captureCancellation(
  matchId: string,
  automaticOnly = true,
): Promise<CancellationOutcome> {
  return cancelUnderfilledTournamentAndRefund(matchId, automaticOnly).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}

test("cancelling one tournament completes while a different PostgreSQL tournament row is locked", async () => {
  const fixture = await createFixture();
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let firstCancellation: Promise<CancellationOutcome> | undefined;
  let independentCancellation: Promise<CancellationOutcome> | undefined;

  try {
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    blockerTransactionOpen = true;
    await blocker.query(
      "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
      [fixture.matchIds[0]],
    );
    const blockerPid = await backendPid(blocker);

    firstCancellation = captureCancellation(fixture.matchIds[0]);
    await waitForBlockedCancellation(blockerPid);

    independentCancellation = captureCancellation(fixture.matchIds[1]);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const independentOutcome = await Promise.race([
      independentCancellation,
      new Promise<{ status: "timeout" }>((resolve) => {
        timeout = setTimeout(() => resolve({ status: "timeout" }), 5_000);
      }),
    ]);
    if (timeout) clearTimeout(timeout);

    assert.equal(
      independentOutcome.status,
      "fulfilled",
      "the unrelated cancellation must finish before releasing the first tournament row lock",
    );
    if (independentOutcome.status === "fulfilled") {
      assert.deepEqual(independentOutcome.value, {
        id: fixture.matchIds[1],
        status: "cancelled",
        registrationsRefunded: 1,
        accountsRefunded: 1,
        coinsRefunded: 35,
      });
    } else if (independentOutcome.status === "rejected") {
      assert.fail(`the unrelated cancellation failed: ${String(independentOutcome.reason)}`);
    }

    await blocker.query("COMMIT");
    blockerTransactionOpen = false;

    const firstOutcome = await firstCancellation;
    assert.equal(firstOutcome.status, "fulfilled");
    if (firstOutcome.status === "fulfilled") {
      assert.deepEqual(firstOutcome.value, {
        id: fixture.matchIds[0],
        status: "cancelled",
        registrationsRefunded: 2,
        accountsRefunded: 2,
        coinsRefunded: 65,
      });
    } else {
      assert.fail(`the locked cancellation failed: ${String(firstOutcome.reason)}`);
    }

    const matches = await pool.query<{ id: string; status: string; enabled: boolean; room_id: string | null }>(
      `SELECT id, status, enabled, room_id
         FROM daily007_v2_matches
        WHERE id = ANY($1::uuid[])`,
      [fixture.matchIds],
    );
    assert.deepEqual(
      new Map(matches.rows.map((match) => [
        match.id,
        { status: match.status, enabled: match.enabled, roomId: match.room_id },
      ])),
      new Map(fixture.matchIds.map((id) => [
        id,
        { status: "cancelled", enabled: false, roomId: null },
      ])),
    );

    const wallets = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );
    assert.deepEqual(
      new Map(wallets.rows.map((wallet) => [wallet.id, wallet.wallet_coins])),
      new Map([
        [fixture.payerIds[0], 125],
        [fixture.payerIds[1], 240],
        [fixture.payerIds[2], 335],
      ]),
    );

    const refunds = await pool.query<{
      match_id: string;
      registration_id: string;
      user_id: string;
      amount: number;
      balance_after: number;
      reason: string;
      idempotency_key: string;
    }>(
      `SELECT match_id, registration_id, user_id, amount, balance_after, reason, idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE match_id = ANY($1::uuid[])
        ORDER BY registration_id`,
      [fixture.matchIds],
    );
    assert.deepEqual(
      new Map(refunds.rows.map((refund) => [
        refund.registration_id,
        {
          matchId: refund.match_id,
          userId: refund.user_id,
          amount: refund.amount,
          balanceAfter: refund.balance_after,
          reason: refund.reason,
          idempotencyKey: refund.idempotency_key,
        },
      ])),
      new Map([
        [
          fixture.registrationIds[0],
          {
            matchId: fixture.matchIds[0],
            userId: fixture.payerIds[0],
            amount: 25,
            balanceAfter: 125,
            reason: "tournament_cancel_refund",
            idempotencyKey: `daily007:tournament-cancel:${fixture.matchIds[0]}:${fixture.registrationIds[0]}`,
          },
        ],
        [
          fixture.registrationIds[1],
          {
            matchId: fixture.matchIds[0],
            userId: fixture.payerIds[1],
            amount: 40,
            balanceAfter: 240,
            reason: "tournament_cancel_refund",
            idempotencyKey: `daily007:tournament-cancel:${fixture.matchIds[0]}:${fixture.registrationIds[1]}`,
          },
        ],
        [
          fixture.registrationIds[2],
          {
            matchId: fixture.matchIds[1],
            userId: fixture.payerIds[2],
            amount: 35,
            balanceAfter: 335,
            reason: "tournament_cancel_refund",
            idempotencyKey: `daily007:tournament-cancel:${fixture.matchIds[1]}:${fixture.registrationIds[2]}`,
          },
        ],
      ]),
    );
  } finally {
    if (blocker && blockerTransactionOpen) await blocker.query("ROLLBACK");
    blocker?.release();
    await Promise.allSettled(
      [firstCancellation, independentCancellation].filter(
        (cancellation): cancellation is Promise<CancellationOutcome> => cancellation !== undefined,
      ),
    );
    await cleanupFixture(fixture);
  }
});

test("a waiting PostgreSQL cancellation succeeds after the second refund fails and the first rolls back", async () => {
  const fixture = await createFixture();
  const matchId = fixture.matchIds[0];
  const pauseKey = 740082n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let firstCancellation: Promise<CancellationOutcome> | undefined;
  let waitingCancellation: Promise<CancellationOutcome> | undefined;

  try {
    const registrations = await pool.query<{
      id: string;
      captain_user_id: string;
      entry_coins_paid: number;
    }>(
      `SELECT id, captain_user_id, entry_coins_paid
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND status IN ('approved', 'pending')
        ORDER BY captain_user_id, id
        LIMIT 2`,
      [matchId],
    );
    const firstRegistration = registrations.rows[0];
    const failingRegistration = registrations.rows[1];
    assert.ok(
      firstRegistration && failingRegistration,
      "The underfilled tournament needs two paid registrations.",
    );
    const firstPayerIndex = fixture.payerIds.indexOf(firstRegistration.captain_user_id);
    assert.notEqual(firstPayerIndex, -1, "The first registration's payer must be in the fixture.");
    const expectedFirstBalance = [100, 200, 300][firstPayerIndex] +
      Number(firstRegistration.entry_coins_paid);

    await pool.query("CREATE SEQUENCE daily007_test_cancel_refund_fail_once");
    await pool.query(`
      CREATE FUNCTION daily007_test_fail_second_cancel_refund() RETURNS trigger AS $$
      BEGIN
        IF NEW.match_id = '${matchId}'::uuid
           AND NEW.registration_id = '${failingRegistration.id}'::uuid THEN
          IF nextval('daily007_test_cancel_refund_fail_once') = 1 THEN
            PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
            IF NOT EXISTS (
              SELECT 1
                FROM daily007_v2_wallet_ledger
               WHERE match_id = '${matchId}'::uuid
                 AND registration_id = '${firstRegistration.id}'::uuid
                 AND reason = 'tournament_cancel_refund'
            ) THEN
              RAISE EXCEPTION 'First cancellation refund ledger write was not reached';
            END IF;
            IF NOT EXISTS (
              SELECT 1
                FROM daily007_v2_users
               WHERE id = '${firstRegistration.captain_user_id}'::uuid
                 AND wallet_coins = ${expectedFirstBalance}
            ) THEN
              RAISE EXCEPTION 'First cancellation refund wallet write was not reached';
            END IF;
            RAISE EXCEPTION 'Injected PostgreSQL second cancellation refund failure';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_fail_second_cancel_refund
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW EXECUTE FUNCTION daily007_test_fail_second_cancel_refund()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
    pauseLockHeld = true;

    firstCancellation = captureCancellation(matchId, false);
    const firstPid = await waitForPausedRefundWrite();
    waitingCancellation = captureCancellation(matchId, false);
    await waitForBlockedCancellation(firstPid);

    await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
    pauseLockHeld = false;

    const [first, waiting] = await Promise.all([
      firstCancellation,
      waitingCancellation,
    ]);
    assert.equal(first.status, "rejected");
    if (first.status === "rejected") {
      assert.match(
        String(first.reason),
        /Injected PostgreSQL second cancellation refund failure/,
      );
    }
    assert.equal(waiting.status, "fulfilled");
    if (waiting.status === "fulfilled") {
      assert.deepEqual(waiting.value, {
        id: matchId,
        status: "cancelled",
        registrationsRefunded: 2,
        accountsRefunded: 2,
        coinsRefunded: 65,
      });
    }

    const match = await pool.query<{ status: string; enabled: boolean }>(
      "SELECT status, enabled FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(match.rows, [{ status: "cancelled", enabled: false }]);

    const wallets = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );
    assert.deepEqual(
      new Map(wallets.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map([
        [fixture.payerIds[0], 125],
        [fixture.payerIds[1], 240],
        [fixture.payerIds[2], 300],
      ]),
    );

    const refunds = await pool.query<{
      registration_id: string;
      user_id: string;
      amount: number;
      balance_after: number;
      reason: string;
      idempotency_key: string;
    }>(
      `SELECT registration_id, user_id, amount, balance_after, reason, idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'
        ORDER BY registration_id`,
      [matchId],
    );
    assert.equal(
      refunds.rows.length,
      2,
      "the successful retry must leave exactly one cancellation refund per paid registration",
    );
    assert.deepEqual(
      new Map(
        refunds.rows.map((refund) => [
          refund.registration_id,
          {
            userId: refund.user_id,
            amount: refund.amount,
            balanceAfter: refund.balance_after,
            reason: refund.reason,
            idempotencyKey: refund.idempotency_key,
          },
        ]),
      ),
      new Map([
        [
          fixture.registrationIds[0],
          {
            userId: fixture.payerIds[0],
            amount: 25,
            balanceAfter: 125,
            reason: "tournament_cancel_refund",
            idempotencyKey: `daily007:tournament-cancel:${matchId}:${fixture.registrationIds[0]}`,
          },
        ],
        [
          fixture.registrationIds[1],
          {
            userId: fixture.payerIds[1],
            amount: 40,
            balanceAfter: 240,
            reason: "tournament_cancel_refund",
            idempotencyKey: `daily007:tournament-cancel:${matchId}:${fixture.registrationIds[1]}`,
          },
        ],
      ]),
    );
  } finally {
    if (blocker) {
      if (pauseLockHeld) {
        await blocker
          .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
          .catch(() => undefined);
      }
      blocker.release();
    }
    await Promise.allSettled(
      [firstCancellation, waitingCancellation].filter(
        (cancellation): cancellation is Promise<CancellationOutcome> =>
          cancellation !== undefined,
      ),
    );
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_fail_second_cancel_refund ON daily007_v2_wallet_ledger",
    );
    await pool.query(
      "DROP FUNCTION IF EXISTS daily007_test_fail_second_cancel_refund()",
    );
    await pool.query(
      "DROP SEQUENCE IF EXISTS daily007_test_cancel_refund_fail_once",
    );
    await cleanupFixture(fixture);
  }
});

test("a waiting PostgreSQL cancellation is rejected after the first cancellation succeeds", async () => {
  const fixture = await createFixture();
  const matchId = fixture.matchIds[0];
  const pauseKey = 740083n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let firstCancellation: Promise<CancellationOutcome> | undefined;
  let waitingCancellation: Promise<CancellationOutcome> | undefined;

  try {
    const firstRegistration = await pool.query<{ id: string }>(
      `SELECT id
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND status IN ('approved', 'pending')
        ORDER BY captain_user_id, id
        LIMIT 1`,
      [matchId],
    );
    const pausedRegistrationId = firstRegistration.rows[0]?.id;
    assert.ok(pausedRegistrationId, "The underfilled tournament needs a paid registration.");

    await pool.query(`
      CREATE FUNCTION daily007_test_pause_cancel_refund() RETURNS trigger AS $$
      BEGIN
        IF NEW.match_id = '${matchId}'::uuid
           AND NEW.registration_id = '${pausedRegistrationId}'::uuid THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_cancel_refund
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_cancel_refund()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
    pauseLockHeld = true;

    firstCancellation = captureCancellation(matchId, false);
    const firstPid = await waitForPausedRefundWrite();
    waitingCancellation = captureCancellation(matchId, false);
    await waitForBlockedCancellation(firstPid);

    await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
    pauseLockHeld = false;

    const [first, waiting] = await Promise.all([
      firstCancellation,
      waitingCancellation,
    ]);
    assert.equal(first.status, "fulfilled");
    if (first.status === "fulfilled") {
      assert.deepEqual(first.value, {
        id: matchId,
        status: "cancelled",
        registrationsRefunded: 2,
        accountsRefunded: 2,
        coinsRefunded: 65,
      });
    } else {
      assert.fail(`the first cancellation failed: ${String(first.reason)}`);
    }

    assert.equal(waiting.status, "rejected");
    if (waiting.status === "rejected") {
      assert.ok(waiting.reason instanceof TournamentCancellationError);
      assert.equal(waiting.reason.status, 409);
      assert.equal(waiting.reason.message, "Tournament is already cancelled.");
    } else {
      assert.fail("the queued cancellation must be rejected after the first succeeds");
    }

    const match = await pool.query<{ status: string; enabled: boolean }>(
      "SELECT status, enabled FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(match.rows, [{ status: "cancelled", enabled: false }]);

    const wallets = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );
    assert.deepEqual(
      new Map(wallets.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map([
        [fixture.payerIds[0], 125],
        [fixture.payerIds[1], 240],
        [fixture.payerIds[2], 300],
      ]),
    );

    const refunds = await pool.query<{
      registration_id: string;
      user_id: string;
      amount: number;
      balance_after: number;
      reason: string;
    }>(
      `SELECT registration_id, user_id, amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'
        ORDER BY registration_id`,
      [matchId],
    );
    assert.equal(
      refunds.rows.length,
      2,
      "the two paid registrations must each have exactly one cancellation refund",
    );
    assert.deepEqual(
      new Map(
        refunds.rows.map((refund) => [
          refund.registration_id,
          {
            userId: refund.user_id,
            amount: refund.amount,
            balanceAfter: refund.balance_after,
            reason: refund.reason,
          },
        ]),
      ),
      new Map([
        [
          fixture.registrationIds[0],
          {
            userId: fixture.payerIds[0],
            amount: 25,
            balanceAfter: 125,
            reason: "tournament_cancel_refund",
          },
        ],
        [
          fixture.registrationIds[1],
          {
            userId: fixture.payerIds[1],
            amount: 40,
            balanceAfter: 240,
            reason: "tournament_cancel_refund",
          },
        ],
      ]),
    );
  } finally {
    if (blocker) {
      if (pauseLockHeld) {
        await blocker
          .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
          .catch(() => undefined);
      }
      blocker.release();
    }
    await Promise.allSettled(
      [firstCancellation, waitingCancellation].filter(
        (cancellation): cancellation is Promise<CancellationOutcome> =>
          cancellation !== undefined,
      ),
    );
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_pause_cancel_refund ON daily007_v2_wallet_ledger",
    );
    await pool.query(
      "DROP FUNCTION IF EXISTS daily007_test_pause_cancel_refund()",
    );
    await cleanupFixture(fixture);
  }
});

test("automatic and manual PostgreSQL cancellations refund once for both modes and lock orders", async () => {
  const scenarios = [
    { gameMode: "clash_squad", firstPath: "manual" },
    { gameMode: "clash_squad", firstPath: "automatic" },
    { gameMode: "lone_wolf", firstPath: "manual" },
    { gameMode: "lone_wolf", firstPath: "automatic" },
  ] as const;
  for (const [index, { gameMode, firstPath }] of scenarios.entries()) {
    const fixture = await createFixture();
    const matchId = fixture.matchIds[0];
    const pauseKey = BigInt(740087 + index);
    let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
    let pauseLockHeld = false;
    let manualCancellation: Promise<CancellationOutcome> | undefined;
    let automaticSweep: Promise<void> | undefined;

    try {
      await pool.query(
        "UPDATE daily007_v2_matches SET capacity = 1 WHERE id = $1",
        [fixture.matchIds[1]],
      );
      await pool.query(
        "UPDATE daily007_v2_matches SET game_mode = $2 WHERE id = $1",
        [matchId, gameMode],
      );
      await pool.query(`
        CREATE FUNCTION daily007_test_pause_mixed_cancel_refund() RETURNS trigger AS $$
        BEGIN
          IF NEW.match_id = '${matchId}'::uuid THEN
            PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await pool.query(`
        CREATE TRIGGER daily007_test_pause_mixed_cancel_refund
        BEFORE INSERT ON daily007_v2_wallet_ledger
        FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_mixed_cancel_refund()
      `);

      blocker = await pool.connect();
      await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
      pauseLockHeld = true;

      let firstCancellationPid: number;
      if (firstPath === "manual") {
        manualCancellation = captureCancellation(matchId, false);
        firstCancellationPid = await waitForPausedRefundWrite();
        automaticSweep = runDaily007AutoCancellationSweep();
      } else {
        automaticSweep = runDaily007AutoCancellationSweep();
        firstCancellationPid = await waitForPausedRefundWrite();
        manualCancellation = captureCancellation(matchId, false);
      }
      await waitForBlockedCancellation(firstCancellationPid);

      await blocker.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      pauseLockHeld = false;

      const manualOutcome = await manualCancellation;
      await automaticSweep;
      if (firstPath === "manual") {
        assert.equal(manualOutcome.status, "fulfilled");
        if (manualOutcome.status === "fulfilled") {
          assert.deepEqual(manualOutcome.value, {
            id: matchId,
            status: "cancelled",
            registrationsRefunded: 2,
            accountsRefunded: 2,
            coinsRefunded: 65,
          });
        }
      } else {
        assert.equal(manualOutcome.status, "rejected");
        if (manualOutcome.status === "rejected") {
          assert.ok(manualOutcome.reason instanceof TournamentCancellationError);
          assert.equal(manualOutcome.reason.status, 409);
          assert.equal(manualOutcome.reason.message, "Tournament is already cancelled.");
        }
      }

      const match = await pool.query<{ status: string; enabled: boolean }>(
        "SELECT status, enabled FROM daily007_v2_matches WHERE id = $1",
        [matchId],
      );
      assert.deepEqual(match.rows, [{ status: "cancelled", enabled: false }]);

      const wallets = await pool.query<{ id: string; wallet_coins: number }>(
        "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
        [fixture.payerIds],
      );
      assert.deepEqual(
        new Map(wallets.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
        new Map([
          [fixture.payerIds[0], 125],
          [fixture.payerIds[1], 240],
          [fixture.payerIds[2], 300],
        ]),
      );

      const refunds = await pool.query<{
        registration_id: string;
        amount: number;
        count: number;
      }>(
        `SELECT registration_id, amount, count(*)::integer AS count
           FROM daily007_v2_wallet_ledger
          WHERE match_id = $1 AND reason = 'tournament_cancel_refund'
          GROUP BY registration_id, amount
          ORDER BY registration_id`,
        [matchId],
      );
      assert.deepEqual(refunds.rows, [
        { registration_id: fixture.registrationIds[0], amount: 25, count: 1 },
        { registration_id: fixture.registrationIds[1], amount: 40, count: 1 },
      ].sort((left, right) => left.registration_id.localeCompare(right.registration_id)));
    } finally {
      if (blocker && pauseLockHeld) {
        await blocker
          .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
          .catch(() => undefined);
      }
      blocker?.release();
      await Promise.allSettled(
        [manualCancellation, automaticSweep].filter(
          (operation): operation is Promise<unknown> => operation !== undefined,
        ),
      );
      await pool.query(
        "DROP TRIGGER IF EXISTS daily007_test_pause_mixed_cancel_refund ON daily007_v2_wallet_ledger",
      );
      await pool.query(
        "DROP FUNCTION IF EXISTS daily007_test_pause_mixed_cancel_refund()",
      );
      await pool.query("DELETE FROM daily007_v2_settings WHERE id = 1");
      await cleanupFixture(fixture);
    }
  }
});

test("a later prior refund rolls back earlier PostgreSQL cancellation writes", async () => {
  const fixture = await createFixture();
  const matchId = fixture.matchIds[0];

  try {
    const orderedRegistrations = await pool.query<{
      id: string;
      captain_user_id: string;
      entry_coins_paid: number;
    }>(
      `SELECT id, captain_user_id, entry_coins_paid
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND status IN ('approved', 'pending')
        ORDER BY captain_user_id, id`,
      [matchId],
    );
    const firstRegistration = orderedRegistrations.rows[0];
    const laterRegistration = orderedRegistrations.rows[1];
    assert.ok(firstRegistration && laterRegistration);

    const laterPayer = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [laterRegistration.captain_user_id],
    );
    const priorBalance = Number(laterPayer.rows[0]?.wallet_coins) +
      Number(laterRegistration.entry_coins_paid);
    await pool.query(
      "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
      [laterRegistration.captain_user_id, priorBalance],
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, match_id, registration_id,
          idempotency_key, details)
       VALUES ($1, $2, $3, 'registration_refund', $4, $5, $6, $7::jsonb)`,
      [
        laterRegistration.captain_user_id,
        laterRegistration.entry_coins_paid,
        priorBalance,
        matchId,
        laterRegistration.id,
        `daily007:test-prior-registration-refund:${laterRegistration.id}`,
        JSON.stringify({ description: "Seeded prior registration refund" }),
      ],
    );

    const balancesBefore = await pool.query<{
      id: string;
      wallet_coins: number;
    }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );

    const outcome = await captureCancellation(matchId, true);
    assert.equal(outcome.status, "rejected");
    if (outcome.status === "rejected") {
      assert.ok(outcome.reason instanceof TournamentCancellationError);
      assert.equal(outcome.reason.status, 409);
      assert.match(outcome.reason.message, /already has a refund record/);
    }

    const match = await pool.query<{ status: string; enabled: boolean }>(
      "SELECT status, enabled FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(match.rows, [{ status: "open", enabled: true }]);

    const balancesAfter = await pool.query<{
      id: string;
      wallet_coins: number;
    }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );
    assert.deepEqual(
      new Map(balancesAfter.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map(balancesBefore.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      "earlier cancellation credits must roll back when a later registration already has a refund",
    );

    const refunds = await pool.query<{
      registration_id: string;
      user_id: string;
      amount: number;
      reason: string;
    }>(
      `SELECT registration_id, user_id, amount, reason
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1
          AND reason IN ('registration_refund', 'tournament_cancel_refund')
        ORDER BY registration_id`,
      [matchId],
    );
    assert.deepEqual(refunds.rows, [{
      registration_id: laterRegistration.id,
      user_id: laterRegistration.captain_user_id,
      amount: Number(laterRegistration.entry_coins_paid),
      reason: "registration_refund",
    }]);
    assert.notEqual(
      firstRegistration.id,
      laterRegistration.id,
      "the seeded prior refund must sort after a registration cancellation would otherwise refund",
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

test("the Admin cancellation endpoint clearly reports when the automatic sweep wins", async () => {
  const fixture = await createFixture();
  const matchId = fixture.matchIds[0];
  const adminId = fixture.payerIds[2];
  const pauseKey = 740086n;
  let blocker: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let pauseLockHeld = false;
  let automaticSweep: Promise<void> | undefined;
  let adminResponse: Promise<Response> | undefined;

  try {
    await pool.query(
      "UPDATE daily007_v2_matches SET capacity = 1 WHERE id = $1",
      [fixture.matchIds[1]],
    );
    await pool.query(
      "UPDATE daily007_v2_users SET role = 'tournament_admin' WHERE id = $1",
      [adminId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_settings (id, settings)
       VALUES (1, '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
    );

    const token = makeToken(adminId, 0);
    assert.ok(token, "The isolated test should create a valid tournament-admin token.");

    await pool.query(`
      CREATE FUNCTION daily007_test_pause_auto_cancel_for_admin_race() RETURNS trigger AS $$
      BEGIN
        IF NEW.match_id = '${matchId}'::uuid THEN
          PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_pause_auto_cancel_for_admin_race
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW EXECUTE FUNCTION daily007_test_pause_auto_cancel_for_admin_race()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
    pauseLockHeld = true;

    await withCompatServer(async (origin) => {
      automaticSweep = runDaily007AutoCancellationSweep();
      const automaticPid = await waitForPausedRefundWrite();
      adminResponse = fetch(`${origin}/admin/tournaments/${matchId}/lifecycle`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "cancelled" }),
      });
      await waitForBlockedCancellation(automaticPid);

      await blocker!.query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`);
      pauseLockHeld = false;

      await automaticSweep;
      const response = await adminResponse;
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "Tournament is already cancelled.",
      });
    });

    const match = await pool.query<{ status: string; enabled: boolean }>(
      "SELECT status, enabled FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(match.rows, [{ status: "cancelled", enabled: false }]);

    const wallets = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );
    assert.deepEqual(
      new Map(wallets.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map([
        [fixture.payerIds[0], 125],
        [fixture.payerIds[1], 240],
        [fixture.payerIds[2], 300],
      ]),
    );

    const refunds = await pool.query<{
      registration_id: string;
      amount: number;
      count: number;
    }>(
      `SELECT registration_id, amount, count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'
        GROUP BY registration_id, amount
        ORDER BY registration_id`,
      [matchId],
    );
    assert.deepEqual(
      refunds.rows,
      [
        { registration_id: fixture.registrationIds[0], amount: 25, count: 1 },
        { registration_id: fixture.registrationIds[1], amount: 40, count: 1 },
      ].sort((left, right) => left.registration_id.localeCompare(right.registration_id)),
    );
  } finally {
    if (blocker && pauseLockHeld) {
      await blocker
        .query(`SELECT pg_advisory_unlock(${pauseKey}::bigint)`)
        .catch(() => undefined);
    }
    blocker?.release();
    const pendingOperations: Promise<unknown>[] = [];
    if (automaticSweep) pendingOperations.push(automaticSweep);
    if (adminResponse) pendingOperations.push(adminResponse);
    await Promise.allSettled(pendingOperations);
    await pool.query(
      "DROP TRIGGER IF EXISTS daily007_test_pause_auto_cancel_for_admin_race ON daily007_v2_wallet_ledger",
    );
    await pool.query(
      "DROP FUNCTION IF EXISTS daily007_test_pause_auto_cancel_for_admin_race()",
    );
    await cleanupFixture(fixture);
  }
});

test("unrelated wallet activity on an active registration does not block its cancellation refund", async () => {
  const fixture = await createFixture();
  const matchId = fixture.matchIds[0];
  const registrationId = fixture.registrationIds[0];
  const payerId = fixture.payerIds[0];

  try {
    await pool.query(
      "UPDATE daily007_v2_users SET wallet_coins = 110 WHERE id = $1",
      [payerId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_wallet_ledger
         (user_id, amount, balance_after, reason, match_id, registration_id,
          idempotency_key, details)
       VALUES ($1, 10, 110, 'admin_credit:unrelated activity', $2, $3, $4, $5::jsonb)`,
      [
        payerId,
        matchId,
        registrationId,
        `daily007:test-unrelated-wallet-activity:${registrationId}`,
        JSON.stringify({ description: "Unrelated wallet activity" }),
      ],
    );

    const outcome = await captureCancellation(matchId, false);
    assert.equal(outcome.status, "fulfilled");
    if (outcome.status === "fulfilled") {
      assert.deepEqual(outcome.value, {
        id: matchId,
        status: "cancelled",
        registrationsRefunded: 2,
        accountsRefunded: 2,
        coinsRefunded: 65,
      });
    } else {
      assert.fail(`unrelated wallet activity must not block cancellation: ${String(outcome.reason)}`);
    }

    const match = await pool.query<{ status: string; enabled: boolean }>(
      "SELECT status, enabled FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(match.rows, [{ status: "cancelled", enabled: false }]);

    const wallets = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );
    assert.deepEqual(
      new Map(wallets.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      new Map([
        [fixture.payerIds[0], 135],
        [fixture.payerIds[1], 240],
        [fixture.payerIds[2], 300],
      ]),
    );

    const registrationLedger = await pool.query<{
      amount: number;
      balance_after: number;
      reason: string;
    }>(
      `SELECT amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE registration_id = $1
        ORDER BY reason`,
      [registrationId],
    );
    assert.deepEqual(registrationLedger.rows, [
      { amount: 10, balance_after: 110, reason: "admin_credit:unrelated activity" },
      { amount: 25, balance_after: 135, reason: "tournament_cancel_refund" },
    ]);

    const refunds = await pool.query<{
      registration_id: string;
      user_id: string;
      amount: number;
      count: number;
    }>(
      `SELECT registration_id, user_id, amount, count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'
        GROUP BY registration_id, user_id, amount
        ORDER BY registration_id`,
      [matchId],
    );
    assert.deepEqual(refunds.rows, [
      {
        registration_id: fixture.registrationIds[0],
        user_id: fixture.payerIds[0],
        amount: 25,
        count: 1,
      },
      {
        registration_id: fixture.registrationIds[1],
        user_id: fixture.payerIds[1],
        amount: 40,
        count: 1,
      },
    ].sort((left, right) => left.registration_id.localeCompare(right.registration_id)));
  } finally {
    await cleanupFixture(fixture);
  }
});
