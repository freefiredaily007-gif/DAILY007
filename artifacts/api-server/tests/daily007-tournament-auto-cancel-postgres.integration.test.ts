import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { pool } from "@workspace/db";
import { runDaily007AutoCancellationSweep } from "../src/lib/daily007-tournament-auto-cancel";

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

const FINALIZATION_TRIGGER = "daily007_test_fail_late_auto_cancel_finalization";
const FINALIZATION_FUNCTION =
  "daily007_test_fail_late_auto_cancel_finalization";
const FINALIZATION_SEQUENCE = "daily007_test_auto_cancel_finalization_attempts";

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
        "INSERT INTO daily007_v2_users (id, wallet_coins) VALUES ($1, $2)",
        [payerId, [120, 80, 70][index]],
      );
    }

    await client.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, game_mode, capacity, starts_at, status,
          enabled, is_full, room_id, room_password, room_published)
       VALUES
         ($1, 'Late Finalization Failure', 'clash', 'clash_squad', 3,
          now() - interval '2 hours', 'open', true, false, 'room-failed',
          'password-failed', true),
         ($2, 'Following Valid Tournament', 'clash', 'lone_wolf', 2,
          now() - interval '1 hour', 'open', true, false, 'room-following',
          'password-following', true)`,
      fixture.matchIds,
    );

    const registrations = [
      {
        id: fixture.registrationIds[0],
        matchId: fixture.matchIds[0],
        payerId: fixture.payerIds[0],
        fee: 25,
        status: "approved",
      },
      {
        id: fixture.registrationIds[1],
        matchId: fixture.matchIds[0],
        payerId: fixture.payerIds[1],
        fee: 40,
        status: "pending",
      },
      {
        id: fixture.registrationIds[2],
        matchId: fixture.matchIds[1],
        payerId: fixture.payerIds[2],
        fee: 18,
        status: "approved",
      },
    ];
    for (const registration of registrations) {
      await client.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, entry_coins_paid, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          registration.id,
          registration.matchId,
          registration.payerId,
          registration.fee,
          registration.status,
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

async function installLateFinalizationFailure(
  fixture: CancellationFixture,
): Promise<void> {
  const [failedMatchId] = fixture.matchIds;
  const [firstPayerId, secondPayerId] = fixture.payerIds;
  await pool.query(`CREATE SEQUENCE ${FINALIZATION_SEQUENCE}`);
  await pool.query(`
    CREATE FUNCTION ${FINALIZATION_FUNCTION}() RETURNS trigger AS $function$
    BEGIN
      IF NEW.id = '${failedMatchId}'::uuid AND NEW.status = 'cancelled' THEN
        IF (
          SELECT count(*)
            FROM daily007_v2_wallet_ledger
           WHERE match_id = NEW.id AND reason = 'tournament_cancel_refund'
        ) <> 2 THEN
          RAISE EXCEPTION 'Expected both refund ledger writes before the injected finalization failure';
        END IF;
        IF (SELECT wallet_coins FROM daily007_v2_users WHERE id = '${firstPayerId}'::uuid) <> 145
           OR (SELECT wallet_coins FROM daily007_v2_users WHERE id = '${secondPayerId}'::uuid) <> 120 THEN
          RAISE EXCEPTION 'Expected both wallet refunds before the injected finalization failure';
        END IF;
        PERFORM nextval('${FINALIZATION_SEQUENCE}');
        RAISE EXCEPTION 'Injected late tournament finalization failure';
      END IF;
      RETURN NEW;
    END;
    $function$ LANGUAGE plpgsql
  `);
  await pool.query(`
    CREATE TRIGGER ${FINALIZATION_TRIGGER}
    BEFORE UPDATE OF status ON daily007_v2_matches
    FOR EACH ROW EXECUTE FUNCTION ${FINALIZATION_FUNCTION}()
  `);
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
    await client.query("DELETE FROM daily007_v2_settings WHERE id = 1");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test("late PostgreSQL tournament finalization failure rolls back refunds and the sweep continues", async () => {
  const fixture = await createFixture();
  try {
    await installLateFinalizationFailure(fixture);

    await runDaily007AutoCancellationSweep();

    const triggerAttempt = await pool.query<{
      last_value: string;
      is_called: boolean;
    }>(`SELECT last_value::text, is_called FROM ${FINALIZATION_SEQUENCE}`);
    assert.deepEqual(
      triggerAttempt.rows[0],
      { last_value: "1", is_called: true },
      "the trigger must see both refund ledger writes and updated payer balances before failing finalization",
    );

    const failedMatch = await pool.query<{
      status: string;
      enabled: boolean;
      is_full: boolean;
      room_id: string | null;
      room_password: string | null;
      room_published: boolean;
    }>(
      `SELECT status, enabled, is_full, room_id, room_password, room_published
         FROM daily007_v2_matches WHERE id = $1`,
      [fixture.matchIds[0]],
    );
    assert.deepEqual(failedMatch.rows[0], {
      status: "open",
      enabled: true,
      is_full: false,
      room_id: "room-failed",
      room_password: "password-failed",
      room_published: true,
    });

    const failedPayers = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[fixture.payerIds[0], fixture.payerIds[1]]],
    );
    assert.deepEqual(
      new Map(failedPayers.rows.map((payer) => [payer.id, payer.wallet_coins])),
      new Map([
        [fixture.payerIds[0], 120],
        [fixture.payerIds[1], 80],
      ]),
      "both payer balances must return to their pre-sweep values",
    );

    const failedRefunds = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'`,
      [fixture.matchIds[0]],
    );
    assert.equal(
      failedRefunds.rows[0]?.count,
      0,
      "failed tournament refunds must leave no ledger entries",
    );

    const followingMatch = await pool.query<{ status: string }>(
      "SELECT status FROM daily007_v2_matches WHERE id = $1",
      [fixture.matchIds[1]],
    );
    assert.equal(
      followingMatch.rows[0]?.status,
      "cancelled",
      "the later tournament must still be cancelled",
    );

    const followingPayer = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.payerIds[2]],
    );
    assert.equal(
      followingPayer.rows[0]?.wallet_coins,
      88,
      "the later tournament's entry fee must be refunded",
    );

    const followingRefund = await pool.query<{
      user_id: string;
      amount: number;
      balance_after: number;
      reason: string;
      registration_id: string;
      idempotency_key: string;
    }>(
      `SELECT user_id, amount, balance_after, reason, registration_id, idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1`,
      [fixture.matchIds[1]],
    );
    assert.deepEqual(followingRefund.rows, [
      {
        user_id: fixture.payerIds[2],
        amount: 18,
        balance_after: 88,
        reason: "tournament_cancel_refund",
        registration_id: fixture.registrationIds[2],
        idempotency_key: `daily007:tournament-cancel:${fixture.matchIds[1]}:${fixture.registrationIds[2]}`,
      },
    ]);
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const statement of [
      `DROP TRIGGER IF EXISTS ${FINALIZATION_TRIGGER} ON daily007_v2_matches`,
      `DROP FUNCTION IF EXISTS ${FINALIZATION_FUNCTION}()`,
      `DROP SEQUENCE IF EXISTS ${FINALIZATION_SEQUENCE}`,
    ]) {
      try {
        await pool.query(statement);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await cleanupFixture(fixture);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to clean up isolated tournament cancellation fixtures.",
      );
    }
  }
});
