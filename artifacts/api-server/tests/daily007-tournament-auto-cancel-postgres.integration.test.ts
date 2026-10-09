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
const CURSOR_WRAP_TRIGGER = "daily007_test_fail_cursor_wrap_candidate";
const CURSOR_WRAP_FUNCTION = "daily007_test_fail_cursor_wrap_candidate";
const CURSOR_WRAP_SEQUENCE = "daily007_test_cursor_wrap_attempts";

type CancellationFixture = {
  matchIds: [string, string];
  payerIds: [string, string, string];
  registrationIds: [string, string, string];
};

type CursorWrapFixture = {
  earlierMatchId: string;
  laterMatchIds: string[];
  payerIds: [string, string, string];
  earlierRegistrationIds: [string, string];
  laterRegistrationIds: string[];
  earlierStartsAt: string;
  laterStartsAt: string;
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

async function createCursorWrapFixture(): Promise<CursorWrapFixture> {
  const fixture: CursorWrapFixture = {
    earlierMatchId: "10000000-0000-4000-8000-000000000001",
    laterMatchIds: Array.from(
      { length: 101 },
      (_, index) =>
        `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ),
    payerIds: [randomUUID(), randomUUID(), randomUUID()],
    earlierRegistrationIds: [randomUUID(), randomUUID()],
    laterRegistrationIds: [],
    earlierStartsAt: "",
    laterStartsAt: "",
  };
  fixture.laterRegistrationIds = fixture.laterMatchIds.map(() => randomUUID());

  const laterStartMs = Date.now() - 60 * 60 * 1000;
  fixture.laterStartsAt = new Date(laterStartMs).toISOString();
  fixture.earlierStartsAt = new Date(laterStartMs - 60 * 60 * 1000).toISOString();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [index, payerId] of fixture.payerIds.entries()) {
      await client.query(
        "INSERT INTO daily007_v2_users (id, wallet_coins) VALUES ($1, $2)",
        [payerId, [120, 80, 1_000][index]],
      );
    }

    await client.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, game_mode, capacity, starts_at, status,
          enabled, is_full, room_id, room_password, room_published)
       VALUES
         ($1, 'Earlier Full Tournament', 'clash', 'clash_squad', 2,
          $2::timestamptz, 'open', true, true, 'earlier-room',
          'earlier-password', true)`,
      [fixture.earlierMatchId, fixture.earlierStartsAt],
    );
    for (let index = fixture.laterMatchIds.length - 1; index >= 0; index -= 1) {
      const matchId = fixture.laterMatchIds[index]!;
      await client.query(
        `INSERT INTO daily007_v2_matches
           (id, title, mode, game_mode, capacity, starts_at, status,
            enabled, is_full, room_id, room_password, room_published)
         VALUES ($1, $2, 'clash', 'lone_wolf', 2, $3::timestamptz,
                 'open', true, false, 'later-room', 'later-password', true)`,
        [matchId, `Later Cursor Candidate ${index + 1}`, fixture.laterStartsAt],
      );
    }

    await client.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, entry_coins_paid, status)
       VALUES
         ($1, $2, $3, 25, 'approved'),
         ($4, $2, $5, 40, 'pending')`,
      [
        fixture.earlierRegistrationIds[0],
        fixture.earlierMatchId,
        fixture.payerIds[0],
        fixture.earlierRegistrationIds[1],
        fixture.payerIds[1],
      ],
    );
    for (const [index, registrationId] of fixture.laterRegistrationIds.entries()) {
      await client.query(
        `INSERT INTO daily007_v2_registrations
           (id, match_id, captain_user_id, entry_coins_paid, status)
         VALUES ($1, $2, $3, 1, 'approved')`,
        [registrationId, fixture.laterMatchIds[index], fixture.payerIds[2]],
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

async function installCursorWrapFailure(failedMatchId: string): Promise<void> {
  await pool.query(`CREATE SEQUENCE ${CURSOR_WRAP_SEQUENCE}`);
  await pool.query(`
    CREATE FUNCTION ${CURSOR_WRAP_FUNCTION}() RETURNS trigger AS $function$
    BEGIN
      PERFORM nextval('${CURSOR_WRAP_SEQUENCE}');
      IF NEW.id = '${failedMatchId}'::uuid AND NEW.status = 'cancelled' THEN
        RAISE EXCEPTION 'Injected persistent cancellation failure for cursor-wrap candidate';
      END IF;
      RETURN NEW;
    END;
    $function$ LANGUAGE plpgsql
  `);
  await pool.query(`
    CREATE TRIGGER ${CURSOR_WRAP_TRIGGER}
    BEFORE UPDATE OF status ON daily007_v2_matches
    FOR EACH ROW EXECUTE FUNCTION ${CURSOR_WRAP_FUNCTION}()
  `);
}

async function cleanupCursorWrapFixture(fixture: CursorWrapFixture): Promise<void> {
  const matchIds = [fixture.earlierMatchId, ...fixture.laterMatchIds];
  const registrationIds = [
    ...fixture.earlierRegistrationIds,
    ...fixture.laterRegistrationIds,
  ];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE match_id = ANY($1::uuid[])",
      [matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_registrations WHERE id = ANY($1::uuid[])",
      [registrationIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [matchIds],
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

async function cursorWrapAttemptCount(): Promise<number> {
  const result = await pool.query<{ last_value: string; is_called: boolean }>(
    `SELECT last_value::text, is_called FROM ${CURSOR_WRAP_SEQUENCE}`,
  );
  assert.equal(result.rows[0]?.is_called, true);
  return Number(result.rows[0]?.last_value);
}

async function storedCursor(): Promise<{ id: string; startsAt: string } | undefined> {
  const result = await pool.query<{ settings: Record<string, unknown> }>(
    "SELECT settings FROM daily007_v2_settings WHERE id = 1",
  );
  const cursor = result.rows[0]?.settings?.__daily007AutoCancelCursor;
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
  const value = cursor as { id?: unknown; startsAt?: unknown };
  return typeof value.id === "string" && typeof value.startsAt === "string"
    ? { id: value.id, startsAt: value.startsAt }
    : undefined;
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

test("a PostgreSQL cursor wrap reaches an earlier tournament and caps each batch at 100", async () => {
  const fixture = await createCursorWrapFixture();
  const failedLaterMatchId = fixture.laterMatchIds[0]!;
  const batchEndMatchId = fixture.laterMatchIds[99]!;
  const finalLaterMatchId = fixture.laterMatchIds[100]!;

  try {
    await installCursorWrapFailure(failedLaterMatchId);

    await runDaily007AutoCancellationSweep();

    assert.deepEqual(await storedCursor(), {
      id: batchEndMatchId,
      startsAt: fixture.laterStartsAt,
    });
    assert.equal(await cursorWrapAttemptCount(), 100);

    const initialLaterStatuses = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM daily007_v2_matches
        WHERE id = ANY($1::uuid[])`,
      [[failedLaterMatchId, batchEndMatchId, finalLaterMatchId]],
    );
    assert.deepEqual(
      new Map(initialLaterStatuses.rows.map(({ id, status }) => [id, status])),
      new Map([
        [failedLaterMatchId, "open"],
        [batchEndMatchId, "cancelled"],
        [finalLaterMatchId, "open"],
      ]),
      "the cursor must stop at the 100th same-timestamp UUID, leaving the 101st candidate eligible",
    );
    const firstBatchRefunds = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = ANY($1::uuid[])
          AND reason = 'tournament_cancel_refund'`,
      [fixture.laterMatchIds],
    );
    assert.equal(firstBatchRefunds.rows[0]?.count, 99);

    await pool.query(
      "UPDATE daily007_v2_registrations SET status = 'rejected' WHERE id = $1",
      [fixture.earlierRegistrationIds[1]],
    );

    await runDaily007AutoCancellationSweep();

    assert.deepEqual(await storedCursor(), {
      id: finalLaterMatchId,
      startsAt: fixture.laterStartsAt,
    });
    assert.equal(await cursorWrapAttemptCount(), 101);
    const finalLaterMatch = await pool.query<{ status: string }>(
      "SELECT status FROM daily007_v2_matches WHERE id = $1",
      [finalLaterMatchId],
    );
    assert.equal(finalLaterMatch.rows[0]?.status, "cancelled");

    await runDaily007AutoCancellationSweep();

    assert.equal(
      await cursorWrapAttemptCount(),
      103,
      "the exhausted-cursor sweep must wrap and attempt only the earlier tournament and one still-eligible later match",
    );
    const earlierMatch = await pool.query<{ status: string }>(
      "SELECT status FROM daily007_v2_matches WHERE id = $1",
      [fixture.earlierMatchId],
    );
    assert.equal(earlierMatch.rows[0]?.status, "cancelled");
    const earlierPayer = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.payerIds[0]],
    );
    assert.equal(earlierPayer.rows[0]?.wallet_coins, 145);
    const earlierRefunds = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'`,
      [fixture.earlierMatchId],
    );
    assert.equal(earlierRefunds.rows[0]?.count, 1);
    assert.deepEqual(await storedCursor(), {
      id: failedLaterMatchId,
      startsAt: fixture.laterStartsAt,
    });

    await runDaily007AutoCancellationSweep();

    assert.equal(await cursorWrapAttemptCount(), 104);
    const finalEarlierPayer = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.payerIds[0]],
    );
    assert.equal(finalEarlierPayer.rows[0]?.wallet_coins, 145);
    const finalEarlierRefunds = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'`,
      [fixture.earlierMatchId],
    );
    assert.equal(finalEarlierRefunds.rows[0]?.count, 1);
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const statement of [
      `DROP TRIGGER IF EXISTS ${CURSOR_WRAP_TRIGGER} ON daily007_v2_matches`,
      `DROP FUNCTION IF EXISTS ${CURSOR_WRAP_FUNCTION}()`,
      `DROP SEQUENCE IF EXISTS ${CURSOR_WRAP_SEQUENCE}`,
    ]) {
      try {
        await pool.query(statement);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await cleanupCursorWrapFixture(fixture);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Failed to clean up isolated cursor-wrap fixtures.",
      );
    }
  }
});
