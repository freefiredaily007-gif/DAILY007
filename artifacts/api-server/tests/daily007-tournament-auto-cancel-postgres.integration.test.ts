import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { runDaily007AutoCancellationSweep } from "../src/lib/daily007-tournament-auto-cancel";
import daily007CompatExtraRouter from "../src/routes/daily007-compat-extra";

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
const CURSOR_SAVE_TRIGGER = "daily007_test_fail_auto_cancel_cursor_save";
const CURSOR_SAVE_FUNCTION = "daily007_test_fail_auto_cancel_cursor_save";
const CURSOR_SAVE_SEQUENCE = "daily007_test_auto_cancel_cursor_save_attempts";
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

type ConcurrentSweepFixture = {
  matchIds: string[];
  registrationIds: string[];
  payerId: string;
};

type SweepWorkerEvent = {
  type: string;
  count?: number;
  id?: string;
};

const SWEEP_WORKER_BUNDLE = "/tmp/daily007-auto-cancel-sweep-worker.cjs";

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

async function installCursorSaveFailure(failedMatchId: string): Promise<void> {
  await pool.query(`CREATE SEQUENCE ${CURSOR_SAVE_SEQUENCE}`);
  await pool.query(`
    CREATE FUNCTION ${CURSOR_SAVE_FUNCTION}() RETURNS trigger AS $function$
    BEGIN
      IF NEW.id = 1 AND NEW.settings ? '__daily007AutoCancelCursor'
         AND nextval('${CURSOR_SAVE_SEQUENCE}') = 1 THEN
        IF (SELECT status FROM daily007_v2_matches WHERE id = '${failedMatchId}'::uuid)
             <> 'cancelled'
           OR (SELECT count(*) FROM daily007_v2_wallet_ledger
                WHERE match_id = '${failedMatchId}'::uuid
                  AND reason = 'tournament_cancel_refund') <> 2 THEN
          RAISE EXCEPTION 'Cursor save failure fired before cancellation refunds committed';
        END IF;
        RAISE EXCEPTION 'Injected automatic cancellation cursor save failure';
      END IF;
      RETURN NEW;
    END;
    $function$ LANGUAGE plpgsql
  `);
  await pool.query(`
    CREATE TRIGGER ${CURSOR_SAVE_TRIGGER}
    BEFORE INSERT OR UPDATE ON daily007_v2_settings
    FOR EACH ROW EXECUTE FUNCTION ${CURSOR_SAVE_FUNCTION}()
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

async function withSettingsServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(daily007CompatExtraRouter);
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

async function createConcurrentSweepFixture(): Promise<ConcurrentSweepFixture> {
  const matchIds = Array.from(
    { length: 200 },
    (_, index) => `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const registrationIds = matchIds.map(() => randomUUID());
  const payerId = randomUUID();
  const startsAt = matchIds.map(
    (_, index) => new Date(Date.now() - 60 * 60 * 1000 + index * 1_000).toISOString(),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO daily007_v2_users (id, wallet_coins) VALUES ($1, 1000)",
      [payerId],
    );
    await client.query(
      `INSERT INTO daily007_v2_matches
         (id, title, mode, game_mode, capacity, starts_at, status,
          enabled, is_full, room_id, room_password, room_published)
       SELECT id, 'Concurrent Cursor Candidate', 'clash', 'clash_squad', 2,
              starts_at, 'open', true, false, NULL, NULL, false
         FROM unnest($1::uuid[], $2::timestamptz[]) AS candidates(id, starts_at)`,
      [matchIds, startsAt],
    );
    await client.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, entry_coins_paid, status)
       SELECT registration_id, match_id, $3, 1, 'approved'
         FROM unnest($1::uuid[], $2::uuid[]) AS registrations(registration_id, match_id)`,
      [registrationIds, matchIds, payerId],
    );
    await client.query("COMMIT");
    return { matchIds, registrationIds, payerId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanupConcurrentSweepFixture(
  fixture: ConcurrentSweepFixture,
): Promise<void> {
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
    await client.query("DELETE FROM daily007_v2_users WHERE id = $1", [fixture.payerId]);
    await client.query("DELETE FROM daily007_v2_settings WHERE id = 1");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function startSweepWorker(pauseBeforeCursorId?: string): {
  child: ChildProcessWithoutNullStreams;
  events: SweepWorkerEvent[];
  waitForEvent(predicate: (event: SweepWorkerEvent) => boolean): Promise<SweepWorkerEvent>;
  done: Promise<void>;
} {
  const child = spawn(process.execPath, [SWEEP_WORKER_BUNDLE], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(pauseBeforeCursorId
        ? { DAILY007_PAUSE_BEFORE_CURSOR_ID: pauseBeforeCursorId }
        : { DAILY007_PAUSE_BEFORE_CURSOR_ID: "" }),
    },
  });
  const events: SweepWorkerEvent[] = [];
  const waiters: Array<{
    predicate: (event: SweepWorkerEvent) => boolean;
    resolve(event: SweepWorkerEvent): void;
    timer: NodeJS.Timeout;
  }> = [];
  let stderr = "";

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.startsWith("WORKER_EVENT:")) return;
    const event = JSON.parse(line.slice("WORKER_EVENT:".length)) as SweepWorkerEvent;
    events.push(event);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!;
      if (!waiter.predicate(event)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(index, 1);
      waiter.resolve(event);
    }
  });

  const waitForEvent = (predicate: (event: SweepWorkerEvent) => boolean) => {
    const previous = events.find(predicate);
    if (previous) return Promise.resolve(previous);
    return new Promise<SweepWorkerEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for sweep worker event. ${stderr}`));
      }, 15_000);
      waiters.push({ predicate, resolve, timer });
    });
  };
  const done = new Promise<void>((resolve, reject) => {
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Sweep worker exited with code ${code}. ${stderr}`));
    });
  });
  return { child, events, waitForEvent, done };
}

async function waitForBlockedQuery(
  queryFragment: string,
  expectedBlockerPid: number,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
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
    if (result.rows.some((row) =>
      row.blockers.map(Number).includes(expectedBlockerPid),
    )) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${description} to block in PostgreSQL.`);
}

test("a PostgreSQL cursor write preserves the video seed marker and visible settings", async () => {
  const fixture = await createFixture();
  const visibleSettings = {
    __daily007VideoCatalogSeeded: true,
    rechargeEnabled: "false",
    coinToMoneyRate: "2.5",
    paymentNote: "Existing payment instructions",
  };

  try {
    await pool.query(
      `INSERT INTO daily007_v2_settings (id, settings)
       VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`,
      [JSON.stringify(visibleSettings)],
    );
    const lastMatch = await pool.query<{ starts_at: Date }>(
      "SELECT starts_at FROM daily007_v2_matches WHERE id = $1",
      [fixture.matchIds[1]],
    );
    assert.ok(lastMatch.rows[0]?.starts_at instanceof Date);

    await runDaily007AutoCancellationSweep();

    const saved = await pool.query<{ settings: Record<string, unknown> }>(
      "SELECT settings FROM daily007_v2_settings WHERE id = 1",
    );
    const expectedCursor = {
      id: fixture.matchIds[1],
      startsAt: lastMatch.rows[0].starts_at.toISOString(),
    };
    assert.deepEqual(saved.rows[0]?.settings, {
      ...visibleSettings,
      __daily007AutoCancelCursor: expectedCursor,
    });
    assert.deepEqual(await storedCursor(), expectedCursor);

    await withSettingsServer(async (origin) => {
      const response = await fetch(`${origin}/settings`);
      assert.equal(response.status, 200);
      const publicSettings = await response.json() as Record<string, unknown>;
      assert.equal(publicSettings.rechargeEnabled, false);
      assert.equal(publicSettings.coinToMoneyRate, "2.5");
      assert.equal(publicSettings.paymentNote, "Existing payment instructions");
      assert.equal(Object.hasOwn(publicSettings, "__daily007AutoCancelCursor"), false);
      assert.equal(Object.hasOwn(publicSettings, "__daily007VideoCatalogSeeded"), false);
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

test("a match that fills its final seat before the cancellation lock is not refunded", async () => {
  const fixture = await createFixture();
  const matchId = fixture.matchIds[0];
  const finalSeatRegistrationId = randomUUID();
  const [firstPayerId, secondPayerId, finalPayerId] = fixture.payerIds;
  const originalBalances = new Map([
    [firstPayerId, 120],
    [secondPayerId, 80],
    [finalPayerId, 70],
  ]);
  const blocker = await pool.connect();
  let blockerTransactionOpen = false;
  let finalSeatCommitted = false;
  let sweep: Promise<void> | undefined;

  try {
    await pool.query(
      "UPDATE daily007_v2_matches SET capacity = 1 WHERE id = $1",
      [fixture.matchIds[1]],
    );
    await blocker.query("BEGIN");
    blockerTransactionOpen = true;
    await blocker.query(
      "SELECT id FROM daily007_v2_matches WHERE id = $1 FOR NO KEY UPDATE",
      [matchId],
    );
    const blockerPidResult = await blocker.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    const blockerPid = Number(blockerPidResult.rows[0]?.pid);
    assert.ok(Number.isInteger(blockerPid));

    sweep = runDaily007AutoCancellationSweep();
    await waitForBlockedQuery(
      "FOR UPDATE OF m",
      blockerPid,
      "the automatic cancellation transaction to wait for the match lock",
    );

    await pool.query(
      `INSERT INTO daily007_v2_registrations
         (id, match_id, captain_user_id, entry_coins_paid, status)
       VALUES ($1, $2, $3, 0, 'approved')`,
      [finalSeatRegistrationId, matchId, finalPayerId],
    );
    finalSeatCommitted = true;
    await blocker.query("COMMIT");
    blockerTransactionOpen = false;
    await sweep;
    sweep = undefined;

    const match = await pool.query<{ status: string; capacity: number }>(
      "SELECT status, capacity FROM daily007_v2_matches WHERE id = $1",
      [matchId],
    );
    assert.deepEqual(match.rows, [{ status: "open", capacity: 3 }]);

    const activeRegistrations = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND status IN ('approved', 'pending')`,
      [matchId],
    );
    assert.equal(activeRegistrations.rows[0]?.count, 3);

    const refunds = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'`,
      [matchId],
    );
    assert.equal(refunds.rows[0]?.count, 0);

    const balances = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [fixture.payerIds],
    );
    assert.deepEqual(
      new Map(balances.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
      originalBalances,
      "no payer wallet may change when the match fills before cancellation locks it",
    );
  } finally {
    if (blockerTransactionOpen) await blocker.query("ROLLBACK");
    if (sweep) await sweep;
    blocker.release();
    if (finalSeatCommitted) {
      await pool.query(
        "DELETE FROM daily007_v2_registrations WHERE id = $1",
        [finalSeatRegistrationId],
      );
    }
    await cleanupFixture(fixture);
  }
});

test("concurrent PostgreSQL sweeps cannot move the saved cursor backwards", async () => {
  const fixture = await createConcurrentSweepFixture();
  const slowWorker = startSweepWorker(fixture.matchIds[99]);
  let fastWorker: ReturnType<typeof startSweepWorker> | undefined;

  try {
    await pool.query(
      "INSERT INTO daily007_v2_settings (id, settings) VALUES (1, '{}'::jsonb)",
    );
    const slowBatch = await slowWorker.waitForEvent(
      (event) => event.type === "batch-selected",
    );
    assert.equal(slowBatch.count, 100);
    await slowWorker.waitForEvent(
      (event) => event.type === "cursor-paused" && event.id === fixture.matchIds[99],
    );
    assert.equal(
      (await storedCursor())?.id,
      fixture.matchIds[98],
      "the slow worker must pause after saving only its 99th candidate",
    );

    fastWorker = startSweepWorker();
    const fastBatch = await fastWorker.waitForEvent(
      (event) => event.type === "batch-selected",
    );
    assert.equal(fastBatch.count, 100);
    await fastWorker.done;
    assert.equal(
      (await storedCursor())?.id,
      fixture.matchIds[199],
      "the fast worker must commit progress through the second batch",
    );

    slowWorker.child.stdin.write("resume\n");
    slowWorker.child.stdin.end();
    await slowWorker.done;

    assert.equal(
      (await storedCursor())?.id,
      fixture.matchIds[199],
      "the slow worker's stale cursor must not overwrite newer saved progress",
    );

    const matchRefunds = await pool.query<{
      id: string;
      status: string;
      refund_count: number;
    }>(
      `SELECT match.id, match.status, count(ledger.id)::integer AS refund_count
         FROM daily007_v2_matches match
         LEFT JOIN daily007_v2_wallet_ledger ledger
           ON ledger.match_id = match.id
          AND ledger.reason = 'tournament_cancel_refund'
        WHERE match.id = ANY($1::uuid[])
        GROUP BY match.id, match.status
        ORDER BY match.starts_at, match.id`,
      [fixture.matchIds],
    );
    assert.equal(matchRefunds.rows.length, 200);
    assert.ok(matchRefunds.rows.every(
      ({ status, refund_count }) => status === "cancelled" && refund_count === 1,
    ));

    const payer = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.payerId],
    );
    assert.equal(payer.rows[0]?.wallet_coins, 1_200);
    assert.deepEqual(
      fastWorker.events
        .filter((event) => event.type === "batch-selected")
        .map((event) => event.count),
      [100],
    );
  } finally {
    if (slowWorker.child.exitCode === null) {
      slowWorker.child.stdin.write("resume\n");
      slowWorker.child.stdin.end();
      await slowWorker.done.catch(() => undefined);
    }
    if (fastWorker?.child.exitCode === null) {
      fastWorker.child.kill("SIGTERM");
      await fastWorker.done.catch(() => undefined);
    }
    await cleanupConcurrentSweepFixture(fixture);
  }
});

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

    const cursorAfterFirstSweep = await storedCursor();
    assert.equal(
      cursorAfterFirstSweep?.id,
      fixture.matchIds[1],
      "the persisted cursor must advance past the valid tournament after the earlier failure",
    );

    await pool.query(`DROP TRIGGER ${FINALIZATION_TRIGGER} ON daily007_v2_matches`);
    await pool.query(`DROP FUNCTION ${FINALIZATION_FUNCTION}()`);
    await runDaily007AutoCancellationSweep();

    const attemptsAfterRetry = await pool.query<{
      last_value: string;
      is_called: boolean;
    }>(`SELECT last_value::text, is_called FROM ${FINALIZATION_SEQUENCE}`);
    assert.deepEqual(
      attemptsAfterRetry.rows[0],
      { last_value: "1", is_called: true },
      "the failed finalization trigger must be removed before the retry",
    );

    const retriedMatch = await pool.query<{
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
    assert.deepEqual(retriedMatch.rows[0], {
      status: "cancelled",
      enabled: false,
      is_full: false,
      room_id: null,
      room_password: null,
      room_published: false,
    });

    const retriedPayers = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[fixture.payerIds[0], fixture.payerIds[1]]],
    );
    assert.deepEqual(
      new Map(retriedPayers.rows.map((payer) => [payer.id, payer.wallet_coins])),
      new Map([
        [fixture.payerIds[0], 145],
        [fixture.payerIds[1], 120],
      ]),
      "the retry must credit each payer exactly once",
    );

    const retriedRefunds = await pool.query<{
      user_id: string;
      amount: number;
      balance_after: number;
      reason: string;
      registration_id: string;
      idempotency_key: string;
    }>(
      `SELECT user_id, amount, balance_after, reason, registration_id, idempotency_key
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'
        ORDER BY registration_id`,
      [fixture.matchIds[0]],
    );
    const expectedRetriedRefunds = [
      {
        user_id: fixture.payerIds[0],
        amount: 25,
        balance_after: 145,
        reason: "tournament_cancel_refund",
        registration_id: fixture.registrationIds[0],
        idempotency_key: `daily007:tournament-cancel:${fixture.matchIds[0]}:${fixture.registrationIds[0]}`,
      },
      {
        user_id: fixture.payerIds[1],
        amount: 40,
        balance_after: 120,
        reason: "tournament_cancel_refund",
        registration_id: fixture.registrationIds[1],
        idempotency_key: `daily007:tournament-cancel:${fixture.matchIds[0]}:${fixture.registrationIds[1]}`,
      },
    ].sort((first, second) => first.registration_id.localeCompare(second.registration_id));
    assert.deepEqual(retriedRefunds.rows, expectedRetriedRefunds);

    const laterRefundCount = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'`,
      [fixture.matchIds[1]],
    );
    assert.equal(laterRefundCount.rows[0]?.count, 1);
    const laterPayerAfterRetry = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.payerIds[2]],
    );
    assert.equal(
      laterPayerAfterRetry.rows[0]?.wallet_coins,
      88,
      "retrying the failed tournament must not refund the later tournament again",
    );
    assert.equal(
      (await storedCursor())?.id,
      fixture.matchIds[0],
      "the next sweep must wrap the persisted cursor and advance to the retried tournament",
    );
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

test("a cursor save failure after committed refunds does not repeat them and the next sweep continues", async () => {
  const fixture = await createFixture();
  try {
    await installCursorSaveFailure(fixture.matchIds[0]);

    await runDaily007AutoCancellationSweep();

    const failedCursorWrite = await pool.query<{
      last_value: string;
      is_called: boolean;
    }>(`SELECT last_value::text, is_called FROM ${CURSOR_SAVE_SEQUENCE}`);
    assert.deepEqual(
      failedCursorWrite.rows[0],
      { last_value: "1", is_called: true },
      "the cursor write must fail exactly after the first cancellation",
    );

    const firstMatch = await pool.query<{ status: string }>(
      "SELECT status FROM daily007_v2_matches WHERE id = $1",
      [fixture.matchIds[0]],
    );
    assert.equal(firstMatch.rows[0]?.status, "cancelled");
    const firstPayers = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[fixture.payerIds[0], fixture.payerIds[1]]],
    );
    assert.deepEqual(
      new Map(firstPayers.rows.map((payer) => [payer.id, payer.wallet_coins])),
      new Map([
        [fixture.payerIds[0], 145],
        [fixture.payerIds[1], 120],
      ]),
      "the committed cancellation must have refunded both payers",
    );
    const firstRefunds = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'`,
      [fixture.matchIds[0]],
    );
    assert.equal(firstRefunds.rows[0]?.count, 2);
    assert.equal(await storedCursor(), undefined, "the failed cursor write must not persist progress");

    const laterBeforeRetry = await pool.query<{ status: string }>(
      "SELECT status FROM daily007_v2_matches WHERE id = $1",
      [fixture.matchIds[1]],
    );
    assert.equal(laterBeforeRetry.rows[0]?.status, "open");

    await pool.query(`DROP TRIGGER ${CURSOR_SAVE_TRIGGER} ON daily007_v2_settings`);
    await pool.query(`DROP FUNCTION ${CURSOR_SAVE_FUNCTION}()`);
    await runDaily007AutoCancellationSweep();

    const finalMatchStatuses = await pool.query<{ id: string; status: string }>(
      "SELECT id, status FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    assert.deepEqual(
      new Map(finalMatchStatuses.rows.map((match) => [match.id, match.status])),
      new Map(fixture.matchIds.map((id) => [id, "cancelled"])),
      "the later sweep must continue to the next eligible tournament",
    );

    const firstRefundsAfterRetry = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'`,
      [fixture.matchIds[0]],
    );
    assert.equal(firstRefundsAfterRetry.rows[0]?.count, 2);
    const firstPayersAfterRetry = await pool.query<{ id: string; wallet_coins: number }>(
      "SELECT id, wallet_coins FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[fixture.payerIds[0], fixture.payerIds[1]]],
    );
    assert.deepEqual(
      new Map(firstPayersAfterRetry.rows.map((payer) => [payer.id, payer.wallet_coins])),
      new Map([
        [fixture.payerIds[0], 145],
        [fixture.payerIds[1], 120],
      ]),
      "retrying after a cursor failure must not credit the first tournament again",
    );

    const laterRefunds = await pool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
         FROM daily007_v2_wallet_ledger
        WHERE match_id = $1 AND reason = 'tournament_cancel_refund'`,
      [fixture.matchIds[1]],
    );
    assert.equal(laterRefunds.rows[0]?.count, 1);
    const laterPayer = await pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.payerIds[2]],
    );
    assert.equal(laterPayer.rows[0]?.wallet_coins, 88);
    assert.equal(
      (await storedCursor())?.id,
      fixture.matchIds[1],
      "the successful later sweep must persist progress through the later candidate",
    );
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const statement of [
      `DROP TRIGGER IF EXISTS ${CURSOR_SAVE_TRIGGER} ON daily007_v2_settings`,
      `DROP FUNCTION IF EXISTS ${CURSOR_SAVE_FUNCTION}()`,
      `DROP SEQUENCE IF EXISTS ${CURSOR_SAVE_SEQUENCE}`,
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
  const visibleSettings = {
    __daily007VideoCatalogSeeded: true,
    rechargeEnabled: "false",
    coinToMoneyRate: "2.5",
    paymentNote: "Existing payment instructions",
  };

  try {
    await pool.query(
      `INSERT INTO daily007_v2_settings (id, settings)
       VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET settings = EXCLUDED.settings`,
      [JSON.stringify(visibleSettings)],
    );
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

    await pool.query(
      "UPDATE daily007_v2_registrations SET status = 'approved' WHERE id = $1",
      [fixture.laterRegistrationIds[0]],
    );
    await pool.query(
      "UPDATE daily007_v2_matches SET capacity = 1 WHERE id = $1",
      [failedLaterMatchId],
    );
    const failedLaterRegistration = await pool.query<{ status: string }>(
      "SELECT status FROM daily007_v2_registrations WHERE id = $1",
      [fixture.laterRegistrationIds[0]],
    );
    assert.equal(failedLaterRegistration.rows[0]?.status, "approved");
    const remainingEligibleMatches = await pool.query<{ id: string }>(
      `SELECT m.id
         FROM daily007_v2_matches m
        WHERE m.id = ANY($1::uuid[])
          AND m.status <> 'cancelled'
          AND (
            SELECT count(*)
              FROM daily007_v2_registrations r
             WHERE r.match_id = m.id AND r.status IN ('approved', 'pending')
          ) < m.capacity`,
      [[fixture.earlierMatchId, ...fixture.laterMatchIds]],
    );
    assert.deepEqual(remainingEligibleMatches.rows, []);
    await runDaily007AutoCancellationSweep();

    const settingsAfterCursorReset = await pool.query<{
      settings: Record<string, unknown>;
    }>("SELECT settings FROM daily007_v2_settings WHERE id = 1");
    assert.deepEqual(
      settingsAfterCursorReset.rows[0]?.settings,
      { ...visibleSettings, __daily007AutoCancelCursor: null },
      "exhausting the saved cursor must reset only the cursor and preserve all visible settings",
    );
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
