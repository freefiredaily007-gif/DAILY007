import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { cancelUnderfilledTournamentAndRefund } from "../src/lib/daily007-tournament-cancellation";

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
  await pool.end();
});

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

async function waitForPausedRefundFailure(timeoutMs = 5_000): Promise<number> {
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

test("a waiting PostgreSQL cancellation succeeds after the first refund write rolls back", async () => {
  const fixture = await createFixture();
  const matchId = fixture.matchIds[0];
  const pauseKey = 740082n;
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
    const failingRegistrationId = firstRegistration.rows[0]?.id;
    assert.ok(
      failingRegistrationId,
      "The underfilled tournament needs a paid registration.",
    );

    await pool.query("CREATE SEQUENCE daily007_test_cancel_refund_fail_once");
    await pool.query(`
      CREATE FUNCTION daily007_test_fail_first_cancel_refund() RETURNS trigger AS $$
      BEGIN
        IF NEW.match_id = '${matchId}'::uuid
           AND NEW.registration_id = '${failingRegistrationId}'::uuid THEN
          IF nextval('daily007_test_cancel_refund_fail_once') = 1 THEN
            PERFORM pg_advisory_xact_lock(${pauseKey}::bigint);
            RAISE EXCEPTION 'Injected PostgreSQL cancellation refund failure';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await pool.query(`
      CREATE TRIGGER daily007_test_fail_first_cancel_refund
      BEFORE INSERT ON daily007_v2_wallet_ledger
      FOR EACH ROW EXECUTE FUNCTION daily007_test_fail_first_cancel_refund()
    `);

    blocker = await pool.connect();
    await blocker.query(`SELECT pg_advisory_lock(${pauseKey}::bigint)`);
    pauseLockHeld = true;

    firstCancellation = captureCancellation(matchId, false);
    const firstPid = await waitForPausedRefundFailure();
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
        /Injected PostgreSQL cancellation refund failure/,
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
      "DROP TRIGGER IF EXISTS daily007_test_fail_first_cancel_refund ON daily007_v2_wallet_ledger",
    );
    await pool.query(
      "DROP FUNCTION IF EXISTS daily007_test_fail_first_cancel_refund()",
    );
    await pool.query(
      "DROP SEQUENCE IF EXISTS daily007_test_cancel_refund_fail_once",
    );
    await cleanupFixture(fixture);
  }
});
