import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import router from "../src/routes/daily007-leaderboards";

const testDatabaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
if (
  process.env.DAILY007_ISOLATED_POSTGRES_TEST !== "1" ||
  !testDatabaseUrl ||
  testDatabaseUrl.hostname !== "127.0.0.1" ||
  testDatabaseUrl.pathname !== "/postgres" ||
  testDatabaseUrl.port !== process.env.DAILY007_TEST_POSTGRES_PORT
) {
  throw new Error("This integration test must run through the isolated PostgreSQL test runner.");
}

const TEST_AUTH_SECRET = "daily007-leaderboard-rewards-test-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(async () => {
  await pool.end();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    listening.once("error", reject);
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

async function waitForBlockedBackend(
  blockerPid: number,
  queryPattern: string,
  description: string,
  timeoutMs = 5_000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number }>(
      `SELECT waiting.pid
         FROM pg_stat_activity AS waiting
        WHERE waiting.pid <> pg_backend_pid()
          AND waiting.wait_event_type = 'Lock'
          AND waiting.query ILIKE $1
          AND $2 = ANY(pg_blocking_pids(waiting.pid))
        ORDER BY waiting.query_start
        LIMIT 1`,
      [queryPattern, blockerPid],
    );
    const pid = result.rows[0]?.pid;
    if (pid !== undefined) return Number(pid);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${description} to block in PostgreSQL.`);
}

test("six-digit leaderboard prizes persist across a fresh API server instance", async () => {
  const adminId = randomUUID();
  const token = makeToken(adminId, 0);
  assert.ok(token);
  const savedRewards = {
    weekly: { firstPlaceCoins: 123456, secondPlaceCoins: 234567, thirdPlaceCoins: 345678 },
    monthly: { firstPlaceCoins: 456789, secondPlaceCoins: 567890, thirdPlaceCoins: 678901 },
  };
  const rewardAmountsFrom = (body: typeof savedRewards) => ({
    weekly: {
      firstPlaceCoins: body.weekly.firstPlaceCoins,
      secondPlaceCoins: body.weekly.secondPlaceCoins,
      thirdPlaceCoins: body.weekly.thirdPlaceCoins,
    },
    monthly: {
      firstPlaceCoins: body.monthly.firstPlaceCoins,
      secondPlaceCoins: body.monthly.secondPlaceCoins,
      thirdPlaceCoins: body.monthly.thirdPlaceCoins,
    },
  });

  await pool.query(
    `INSERT INTO daily007_v2_users (id, name, email, role)
     VALUES ($1, 'Leaderboard Test Admin', $2, 'admin')`,
    [adminId, `leaderboard-${adminId}@example.test`],
  );
  try {
    await withServer(async (origin) => {
      const response = await fetch(`${origin}/daily007/v2/admin/leaderboards/rewards`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(savedRewards),
      });
      assert.equal(response.status, 200);
      const body = await response.json() as typeof savedRewards;
      assert.deepEqual(rewardAmountsFrom(body), savedRewards);
    });

    // Recreate the Express API server; the next read uses PostgreSQL, not an in-memory fixture.
    await withServer(async (origin) => {
      const response = await fetch(`${origin}/daily007/v2/admin/leaderboards/rewards`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.status, 200);
      const body = await response.json() as typeof savedRewards;
      assert.deepEqual(rewardAmountsFrom(body), savedRewards);
    });
  } finally {
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
  }
});

test("a monthly active-period snapshot failure rolls back weekly and monthly prizes in PostgreSQL", async () => {
  const adminId = randomUUID();
  const playerId = randomUUID();
  const weeklyPeriodId = randomUUID();
  const monthlyPeriodId = randomUUID();
  const matchId = randomUUID();
  const token = makeToken(adminId, 0);
  assert.ok(token);

  const originalRewards = {
    weekly: [
      { rank: 1, coins: 51 },
      { rank: 2, coins: 42 },
      { rank: 3, coins: 33 },
    ],
    monthly: [
      { rank: 1, coins: 91 },
      { rank: 2, coins: 62 },
      { rank: 3, coins: 33 },
    ],
  };
  const attemptedRewards = {
    weekly: { firstPlaceCoins: 701, secondPlaceCoins: 702, thirdPlaceCoins: 703 },
    monthly: { firstPlaceCoins: 801, secondPlaceCoins: 802, thirdPlaceCoins: 803 },
  };
  const now = new Date();
  const startsAt = new Date(now.getTime() - 86_400_000);
  const endsAt = new Date(now.getTime() + 86_400_000);
  const originalUpdatedAt = new Date("2026-01-01T00:00:00.000Z");

  await pool.query(
    `INSERT INTO daily007_v2_users (id, name, email, role)
     VALUES
       ($1, 'Leaderboard Rollback Admin', $2, 'admin'),
       ($3, 'Leaderboard Rollback Player', $4, 'user')`,
    [adminId, `leaderboard-rollback-admin-${adminId}@example.test`, playerId, `leaderboard-rollback-player-${playerId}@example.test`],
  );
  try {
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_reward_settings
         (cycle_type, first_place_coins, second_place_coins, third_place_coins, updated_by, updated_at)
       VALUES
         ('weekly', 51, 42, 33, $1, $2),
         ('monthly', 91, 62, 33, $1, $2)
       ON CONFLICT (cycle_type) DO UPDATE SET
         first_place_coins = EXCLUDED.first_place_coins,
         second_place_coins = EXCLUDED.second_place_coins,
         third_place_coins = EXCLUDED.third_place_coins,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [adminId, originalUpdatedAt],
    );
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_periods
         (id, cycle_type, starts_at, ends_at, status, payout_configuration)
       VALUES
         ($1, 'weekly', $3, $4, 'active', $5::jsonb),
         ($2, 'monthly', $3, $4, 'active', $6::jsonb)`,
      [
        weeklyPeriodId,
        monthlyPeriodId,
        startsAt,
        endsAt,
        JSON.stringify(originalRewards.weekly),
        JSON.stringify(originalRewards.monthly),
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_matches (id, starts_at)
       VALUES ($1, $2)`,
      [matchId, now],
    );
    await pool.query(
      `INSERT INTO daily007_v2_result_awards (match_id, user_id, rank, kills, prize_coins)
       VALUES ($1, $2, 1, 7, 20)`,
      [matchId, playerId],
    );

    await pool.query(`
      CREATE SEQUENCE daily007_test_leaderboard_snapshot_failure_marker;
      CREATE FUNCTION daily007_test_fail_monthly_active_snapshot() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.cycle_type = 'monthly' AND NEW.status = 'active' THEN
          IF (SELECT first_place_coins FROM daily007_v2_leaderboard_reward_settings WHERE cycle_type = 'weekly') <> 701
             OR (SELECT second_place_coins FROM daily007_v2_leaderboard_reward_settings WHERE cycle_type = 'weekly') <> 702
             OR (SELECT third_place_coins FROM daily007_v2_leaderboard_reward_settings WHERE cycle_type = 'weekly') <> 703
             OR (SELECT first_place_coins FROM daily007_v2_leaderboard_reward_settings WHERE cycle_type = 'monthly') <> 801
             OR (SELECT second_place_coins FROM daily007_v2_leaderboard_reward_settings WHERE cycle_type = 'monthly') <> 802
             OR (SELECT third_place_coins FROM daily007_v2_leaderboard_reward_settings WHERE cycle_type = 'monthly') <> 803
             OR (SELECT payout_configuration
                   FROM daily007_v2_leaderboard_periods
                  WHERE id = '${weeklyPeriodId}'::uuid)
                IS DISTINCT FROM '[{"rank":1,"coins":701},{"rank":2,"coins":702},{"rank":3,"coins":703}]'::jsonb
          THEN
            RAISE EXCEPTION 'monthly snapshot failure ran before earlier reward writes';
          END IF;

          PERFORM nextval('daily007_test_leaderboard_snapshot_failure_marker');
          RAISE EXCEPTION 'injected monthly active-period snapshot failure';
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER daily007_test_fail_monthly_active_snapshot
        BEFORE UPDATE OF payout_configuration ON daily007_v2_leaderboard_periods
        FOR EACH ROW
        EXECUTE FUNCTION daily007_test_fail_monthly_active_snapshot();
    `);

    await withServer(async (origin) => {
      const beforeRead = await fetch(`${origin}/daily007/v2/leaderboards`);
      assert.equal(beforeRead.status, 200);
      const originalPlayerView = await beforeRead.json() as {
        weekly: { rewards: unknown[] };
        monthly: { rewards: unknown[] };
      };
      assert.deepEqual(originalPlayerView.weekly.rewards, originalRewards.weekly);
      assert.deepEqual(originalPlayerView.monthly.rewards, originalRewards.monthly);

      const failedSave = await fetch(`${origin}/daily007/v2/admin/leaderboards/rewards`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(attemptedRewards),
      });
      assert.equal(failedSave.status, 500);

      const marker = await pool.query<{ last_value: string; is_called: boolean }>(
        "SELECT last_value, is_called FROM daily007_test_leaderboard_snapshot_failure_marker",
      );
      assert.deepEqual(
        marker.rows[0],
        { last_value: "1", is_called: true },
        "the failure trigger must run after both setting writes and the weekly snapshot update",
      );

      const settings = await pool.query<{
        cycle_type: string;
        first_place_coins: number;
        second_place_coins: number;
        third_place_coins: number;
        updated_by: string | null;
        updated_at: Date;
      }>(
        `SELECT cycle_type, first_place_coins, second_place_coins, third_place_coins, updated_by, updated_at
           FROM daily007_v2_leaderboard_reward_settings
          ORDER BY cycle_type`,
      );
      assert.deepEqual(
        settings.rows.map((row) => ({
          ...row,
          updated_at: new Date(row.updated_at).toISOString(),
        })),
        [
          {
            cycle_type: "monthly",
            first_place_coins: 91,
            second_place_coins: 62,
            third_place_coins: 33,
            updated_by: adminId,
            updated_at: originalUpdatedAt.toISOString(),
          },
          {
            cycle_type: "weekly",
            first_place_coins: 51,
            second_place_coins: 42,
            third_place_coins: 33,
            updated_by: adminId,
            updated_at: originalUpdatedAt.toISOString(),
          },
        ],
        "both reward settings and their update metadata must roll back",
      );

      const periods = await pool.query<{
        id: string;
        cycle_type: string;
        status: string;
        payout_configuration: unknown;
      }>(
        `SELECT id, cycle_type, status, payout_configuration
           FROM daily007_v2_leaderboard_periods
          WHERE id IN ($1, $2)
          ORDER BY cycle_type`,
        [weeklyPeriodId, monthlyPeriodId],
      );
      assert.deepEqual(
        periods.rows,
        [
          {
            id: monthlyPeriodId,
            cycle_type: "monthly",
            status: "active",
            payout_configuration: originalRewards.monthly,
          },
          {
            id: weeklyPeriodId,
            cycle_type: "weekly",
            status: "active",
            payout_configuration: originalRewards.weekly,
          },
        ],
        "both active-period payout snapshots must remain unchanged",
      );

      const afterRead = await fetch(`${origin}/daily007/v2/leaderboards`);
      assert.equal(afterRead.status, 200);
      const playerView = await afterRead.json() as {
        weekly: { rewards: unknown[] };
        monthly: { rewards: unknown[] };
      };
      assert.deepEqual(playerView.weekly.rewards, originalRewards.weekly);
      assert.deepEqual(playerView.monthly.rewards, originalRewards.monthly);
    });
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_fail_monthly_active_snapshot ON daily007_v2_leaderboard_periods");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_fail_monthly_active_snapshot()");
    await pool.query("DROP SEQUENCE IF EXISTS daily007_test_leaderboard_snapshot_failure_marker");
    await pool.query("DELETE FROM daily007_v2_result_awards WHERE match_id = $1", [matchId]);
    await pool.query("DELETE FROM daily007_v2_matches WHERE id = $1", [matchId]);
    await pool.query("DELETE FROM daily007_v2_leaderboard_periods WHERE id IN ($1, $2)", [weeklyPeriodId, monthlyPeriodId]);
    await pool.query("DELETE FROM daily007_v2_leaderboard_reward_settings WHERE cycle_type IN ('weekly', 'monthly')");
    await pool.query("DELETE FROM daily007_v2_users WHERE id IN ($1, $2)", [adminId, playerId]);
  }
});

test("overlapping weekly and monthly prize saves stay serialized through active-period snapshots", async () => {
  const adminId = randomUUID();
  const weeklyPeriodId = randomUUID();
  const monthlyPeriodId = randomUUID();
  const token = makeToken(adminId, 0);
  assert.ok(token);

  const firstSave = {
    weekly: { firstPlaceCoins: 701, secondPlaceCoins: 702, thirdPlaceCoins: 703 },
    monthly: { firstPlaceCoins: 801, secondPlaceCoins: 802, thirdPlaceCoins: 803 },
  };
  const secondSave = {
    weekly: { firstPlaceCoins: 901, secondPlaceCoins: 902, thirdPlaceCoins: 903 },
    monthly: { firstPlaceCoins: 1001, secondPlaceCoins: 1002, thirdPlaceCoins: 1003 },
  };
  const now = new Date();
  const startsAt = new Date(now.getTime() - 86_400_000);
  const endsAt = new Date(now.getTime() + 86_400_000);
  const gateClient = await pool.connect();
  let gateHeld = false;

  await pool.query(
    `INSERT INTO daily007_v2_users (id, name, email, role)
     VALUES ($1, 'Leaderboard Race Admin', $2, 'admin')`,
    [adminId, `leaderboard-race-admin-${adminId}@example.test`],
  );
  try {
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_reward_settings
         (cycle_type, first_place_coins, second_place_coins, third_place_coins, updated_by)
       VALUES
         ('weekly', 51, 42, 33, $1),
         ('monthly', 91, 62, 33, $1)
       ON CONFLICT (cycle_type) DO UPDATE SET
         first_place_coins = EXCLUDED.first_place_coins,
         second_place_coins = EXCLUDED.second_place_coins,
         third_place_coins = EXCLUDED.third_place_coins,
         updated_by = EXCLUDED.updated_by`,
      [adminId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_periods
         (id, cycle_type, starts_at, ends_at, status, payout_configuration)
       VALUES
         ($1, 'weekly', $3, $4, 'active', '[{"rank":1,"coins":51},{"rank":2,"coins":42},{"rank":3,"coins":33}]'),
         ($2, 'monthly', $3, $4, 'active', '[{"rank":1,"coins":91},{"rank":2,"coins":62},{"rank":3,"coins":33}]')`,
      [weeklyPeriodId, monthlyPeriodId, startsAt, endsAt],
    );

    await pool.query(`
      CREATE FUNCTION daily007_test_pause_first_monthly_reward_save() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.cycle_type = 'monthly' AND NEW.first_place_coins = 801 THEN
          PERFORM pg_advisory_xact_lock(743113);
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER daily007_test_pause_first_monthly_reward_save
        BEFORE INSERT OR UPDATE ON daily007_v2_leaderboard_reward_settings
        FOR EACH ROW
        EXECUTE FUNCTION daily007_test_pause_first_monthly_reward_save();
    `);

    const blocker = await gateClient.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    const blockerPid = Number(blocker.rows[0]?.pid);
    assert.ok(blockerPid > 0);
    await gateClient.query("SELECT pg_advisory_lock(743113)");
    gateHeld = true;

    await withServer(async (origin) => {
      const putRewards = (rewards: typeof firstSave) => fetch(
        `${origin}/daily007/v2/admin/leaderboards/rewards`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(rewards),
        },
      );

      const firstRequest = putRewards(firstSave);
      const firstBackendPid = await waitForBlockedBackend(
        blockerPid,
        "INSERT INTO daily007_v2_leaderboard_reward_settings%",
        "the first reward save to pause after its weekly writes",
      );
      const secondRequest = putRewards(secondSave);
      await waitForBlockedBackend(
        firstBackendPid,
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)%",
        "the second reward save to queue behind the complete first save",
      );

      await gateClient.query("SELECT pg_advisory_unlock(743113)");
      gateHeld = false;

      const [firstResponse, secondResponse] = await Promise.all([
        firstRequest,
        secondRequest,
      ]);
      assert.equal(firstResponse.status, 200);
      assert.equal(secondResponse.status, 200);

      const settings = await pool.query<{
        cycle_type: string;
        first_place_coins: number;
        second_place_coins: number;
        third_place_coins: number;
      }>(
        `SELECT cycle_type, first_place_coins, second_place_coins, third_place_coins
           FROM daily007_v2_leaderboard_reward_settings
          ORDER BY cycle_type`,
      );
      assert.deepEqual(settings.rows, [
        {
          cycle_type: "monthly",
          first_place_coins: secondSave.monthly.firstPlaceCoins,
          second_place_coins: secondSave.monthly.secondPlaceCoins,
          third_place_coins: secondSave.monthly.thirdPlaceCoins,
        },
        {
          cycle_type: "weekly",
          first_place_coins: secondSave.weekly.firstPlaceCoins,
          second_place_coins: secondSave.weekly.secondPlaceCoins,
          third_place_coins: secondSave.weekly.thirdPlaceCoins,
        },
      ]);

      const snapshots = await pool.query<{
        id: string;
        payout_configuration: unknown;
      }>(
        `SELECT id, payout_configuration
           FROM daily007_v2_leaderboard_periods
          WHERE id IN ($1, $2)
          ORDER BY id`,
        [weeklyPeriodId, monthlyPeriodId],
      );
      assert.deepEqual(
        new Map(snapshots.rows.map((row) => [row.id, row.payout_configuration])),
        new Map([
          [weeklyPeriodId, [
            { rank: 1, coins: secondSave.weekly.firstPlaceCoins },
            { rank: 2, coins: secondSave.weekly.secondPlaceCoins },
            { rank: 3, coins: secondSave.weekly.thirdPlaceCoins },
          ]],
          [monthlyPeriodId, [
            { rank: 1, coins: secondSave.monthly.firstPlaceCoins },
            { rank: 2, coins: secondSave.monthly.secondPlaceCoins },
            { rank: 3, coins: secondSave.monthly.thirdPlaceCoins },
          ]],
        ]),
      );

      const playerViewResponse = await fetch(`${origin}/daily007/v2/leaderboards`);
      assert.equal(playerViewResponse.status, 200);
      const playerView = await playerViewResponse.json() as {
        weekly: { rewards: unknown[] };
        monthly: { rewards: unknown[] };
      };
      assert.deepEqual(playerView.weekly.rewards, [
        { rank: 1, coins: secondSave.weekly.firstPlaceCoins },
        { rank: 2, coins: secondSave.weekly.secondPlaceCoins },
        { rank: 3, coins: secondSave.weekly.thirdPlaceCoins },
      ]);
      assert.deepEqual(playerView.monthly.rewards, [
        { rank: 1, coins: secondSave.monthly.firstPlaceCoins },
        { rank: 2, coins: secondSave.monthly.secondPlaceCoins },
        { rank: 3, coins: secondSave.monthly.thirdPlaceCoins },
      ]);
    });
  } finally {
    if (gateHeld) await gateClient.query("SELECT pg_advisory_unlock(743113)");
    gateClient.release();
    await pool.query("DROP TRIGGER IF EXISTS daily007_test_pause_first_monthly_reward_save ON daily007_v2_leaderboard_reward_settings");
    await pool.query("DROP FUNCTION IF EXISTS daily007_test_pause_first_monthly_reward_save()");
    await pool.query(
      "DELETE FROM daily007_v2_leaderboard_periods WHERE id IN ($1, $2)",
      [weeklyPeriodId, monthlyPeriodId],
    );
    await pool.query("DELETE FROM daily007_v2_leaderboard_reward_settings");
    await pool.query("DELETE FROM daily007_v2_users WHERE id = $1", [adminId]);
  }
});

test("monthly approval pays its saved prize snapshot after current rewards change in PostgreSQL", async () => {
  const adminId = randomUUID();
  const firstPlayerId = randomUUID();
  const secondPlayerId = randomUUID();
  const thirdPlayerId = randomUUID();
  const monthlyPeriodId = randomUUID();
  const token = makeToken(adminId, 0);
  assert.ok(token);

  const savedMonthlyRewards = [
    { rank: 1, coins: 25 },
    { rank: 2, coins: 0 },
    { rank: 3, coins: 5 },
  ];
  const updatedCurrentRewards = {
    weekly: { firstPlaceCoins: 701, secondPlaceCoins: 702, thirdPlaceCoins: 703 },
    monthly: { firstPlaceCoins: 801, secondPlaceCoins: 802, thirdPlaceCoins: 803 },
  };
  const approvedAt = new Date();
  const startsAt = new Date(approvedAt.getTime() - 31 * 86_400_000);
  const endsAt = new Date(approvedAt.getTime() - 60_000);
  const standings = [
    { rank: 1, userId: firstPlayerId, name: "Snapshot First", points: 900, earnings: 900, wins: 4, kills: 15, matches: 6 },
    { rank: 2, userId: secondPlayerId, name: "Snapshot Second", points: 500, earnings: 500, wins: 2, kills: 10, matches: 5 },
    { rank: 3, userId: thirdPlayerId, name: "Snapshot Third", points: 350, earnings: 350, wins: 1, kills: 8, matches: 4 },
  ];

  try {
    await pool.query(
      `INSERT INTO daily007_v2_users
         (id, name, email, role, wallet_coins, status, auth_version)
       VALUES
         ($1, 'Leaderboard Snapshot Admin', $2, 'admin', 0, 'active', 0),
         ($3, 'Snapshot First', $4, 'user', 100, 'active', 0),
         ($5, 'Snapshot Second', $6, 'user', 100, 'active', 0),
         ($7, 'Snapshot Third', $8, 'user', 100, 'active', 0)`,
      [
        adminId,
        `leaderboard-snapshot-admin-${adminId}@example.test`,
        firstPlayerId,
        `leaderboard-snapshot-first-${firstPlayerId}@example.test`,
        secondPlayerId,
        `leaderboard-snapshot-second-${secondPlayerId}@example.test`,
        thirdPlayerId,
        `leaderboard-snapshot-third-${thirdPlayerId}@example.test`,
      ],
    );
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_reward_settings
         (cycle_type, first_place_coins, second_place_coins, third_place_coins, updated_by)
       VALUES
         ('weekly', 50, 40, 30, $1),
         ('monthly', 90, 60, 30, $1)`,
      [adminId],
    );
    await pool.query(
      `INSERT INTO daily007_v2_leaderboard_periods
         (id, cycle_type, starts_at, ends_at, status, final_standings, payout_configuration)
       VALUES ($1, 'monthly', $2, $3, 'pending_approval', $4::jsonb, $5::jsonb)`,
      [
        monthlyPeriodId,
        startsAt,
        endsAt,
        JSON.stringify(standings),
        JSON.stringify(savedMonthlyRewards),
      ],
    );

    await withServer(async (origin) => {
      const saveResponse = await fetch(`${origin}/daily007/v2/admin/leaderboards/rewards`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(updatedCurrentRewards),
      });
      assert.equal(saveResponse.status, 200);

      const currentSettings = await pool.query<{
        cycle_type: string;
        first_place_coins: number;
        second_place_coins: number;
        third_place_coins: number;
      }>(
        `SELECT cycle_type, first_place_coins, second_place_coins, third_place_coins
           FROM daily007_v2_leaderboard_reward_settings
          ORDER BY cycle_type`,
      );
      assert.deepEqual(currentSettings.rows, [
        {
          cycle_type: "monthly",
          first_place_coins: 801,
          second_place_coins: 802,
          third_place_coins: 803,
        },
        {
          cycle_type: "weekly",
          first_place_coins: 701,
          second_place_coins: 702,
          third_place_coins: 703,
        },
      ]);

      const approvalResponse = await fetch(
        `${origin}/daily007/v2/admin/leaderboards/periods/${monthlyPeriodId}/approve`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        },
      );
      assert.equal(approvalResponse.status, 200);
      const approval = await approvalResponse.json() as {
        cycleType: string;
        rewards: { rank: number; coins: number }[];
        payouts: {
          rank: number;
          userId: string;
          coins: number;
          balanceAfter: number;
        }[];
      };
      assert.equal(approval.cycleType, "monthly");
      assert.deepEqual(approval.rewards, savedMonthlyRewards);
      assert.deepEqual(
        approval.payouts.map(({ rank, userId, coins, balanceAfter }) => ({
          rank,
          userId,
          coins,
          balanceAfter,
        })),
        [
          { rank: 1, userId: firstPlayerId, coins: 25, balanceAfter: 125 },
          { rank: 3, userId: thirdPlayerId, coins: 5, balanceAfter: 105 },
        ],
      );

      const wallets = await pool.query<{
        id: string;
        wallet_coins: number;
      }>(
        `SELECT id, wallet_coins
           FROM daily007_v2_users
          WHERE id = ANY($1::uuid[])
          ORDER BY id`,
        [[firstPlayerId, secondPlayerId, thirdPlayerId]],
      );
      assert.deepEqual(
        new Map(wallets.rows.map(({ id, wallet_coins }) => [id, wallet_coins])),
        new Map([
          [firstPlayerId, 125],
          [secondPlayerId, 100],
          [thirdPlayerId, 105],
        ]),
      );

      const ledger = await pool.query<{
        user_id: string;
        amount: number;
        balance_after: number;
        reason: string;
        idempotency_key: string;
        details: Record<string, unknown>;
      }>(
        `SELECT user_id, amount, balance_after, reason, idempotency_key, details
           FROM daily007_v2_wallet_ledger
          ORDER BY idempotency_key`,
      );
      assert.deepEqual(
        ledger.rows.map(({ user_id, amount, balance_after, reason, idempotency_key, details }) => ({
          user_id,
          amount,
          balance_after,
          reason,
          idempotency_key,
          details,
        })),
        [
          {
            user_id: firstPlayerId,
            amount: 25,
            balance_after: 125,
            reason: "Monthly Leaderboard Rank #1 Reward",
            idempotency_key: `leaderboard-cycle:${monthlyPeriodId}:rank:1`,
            details: {
              description: "Monthly Leaderboard Rank #1 Reward",
              periodId: monthlyPeriodId,
              cycleType: "monthly",
              rank: 1,
              points: 900,
            },
          },
          {
            user_id: thirdPlayerId,
            amount: 5,
            balance_after: 105,
            reason: "Monthly Leaderboard Rank #3 Reward",
            idempotency_key: `leaderboard-cycle:${monthlyPeriodId}:rank:3`,
            details: {
              description: "Monthly Leaderboard Rank #3 Reward",
              periodId: monthlyPeriodId,
              cycleType: "monthly",
              rank: 3,
              points: 350,
            },
          },
        ],
      );

      const savedPeriod = await pool.query<{
        status: string;
        payout_configuration: unknown;
      }>(
        `SELECT status, payout_configuration
           FROM daily007_v2_leaderboard_periods
          WHERE id = $1`,
        [monthlyPeriodId],
      );
      assert.deepEqual(savedPeriod.rows[0], {
        status: "finalized",
        payout_configuration: savedMonthlyRewards,
      });
    });
  } finally {
    await pool.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = ANY($1::uuid[])",
      [[firstPlayerId, secondPlayerId, thirdPlayerId]],
    );
    await pool.query(
      "DELETE FROM daily007_v2_leaderboard_periods WHERE id = $1",
      [monthlyPeriodId],
    );
    await pool.query(
      "DELETE FROM daily007_v2_leaderboard_reward_settings WHERE cycle_type IN ('weekly', 'monthly')",
    );
    await pool.query(
      "DELETE FROM daily007_v2_users WHERE id = ANY($1::uuid[])",
      [[adminId, firstPlayerId, secondPlayerId, thirdPlayerId]],
    );
  }
});
