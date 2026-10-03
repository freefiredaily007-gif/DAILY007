import { pool } from "@workspace/db";
import { logger } from "./logger";
import {
  leaderboardPeriodWindow,
  nextLeaderboardPeriodWindow,
  parseSafeInteger,
  rankLeaderboardStandings,
  type LeaderboardCycleType,
  type LeaderboardPayout,
  type LeaderboardPeriodStatus,
  type LeaderboardStanding,
} from "./daily007-leaderboard-core";

const CYCLE_TYPES: LeaderboardCycleType[] = ["weekly", "monthly"];
const MAX_INT = 2_147_483_647;
const LOCK_NAME = "daily007-leaderboard-periods";
const SCHEDULER_INTERVAL_MS = 60_000;
const MAX_PERIOD_CATCHUP = 600;

type QueryResult<T> = { rows: T[] };
type Queryable = {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
};
type SqlClient = Queryable & { release(): void };

type PeriodRow = {
  id: string;
  cycle_type: LeaderboardCycleType;
  starts_at: Date | string;
  ends_at: Date | string;
  status: LeaderboardPeriodStatus;
  previous_period_id: string | null;
  final_standings: unknown;
  payout_configuration: unknown;
};

type RawStanding = {
  userId: string;
  name: string;
  points: number | string;
  earnings: number | string;
  wins: number | string;
  kills: number | string;
  matches: number | string;
};

type PayoutReceipt = {
  rank: number;
  userId: string;
  coins: number;
  walletCoins: number;
};

let schedulerTimer: NodeJS.Timeout | undefined;
let sweepRunning = false;

function transaction<T>(work: (client: SqlClient) => Promise<T>): Promise<T> {
  return (async () => {
    const client = await pool.connect() as unknown as SqlClient;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
        [LOCK_NAME],
      );
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })();
}

function asDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError("Leaderboard period contains an invalid date.");
  }
  return date;
}

function periodDates(period: PeriodRow) {
  return {
    startsAt: asDate(period.starts_at),
    endsAt: asDate(period.ends_at),
  };
}

async function newestPeriod(
  client: Queryable,
  cycleType: LeaderboardCycleType,
): Promise<PeriodRow | null> {
  const result = await client.query<PeriodRow>(
    `SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,
            final_standings, payout_configuration
       FROM daily007_v2_leaderboard_periods
      WHERE cycle_type = $1
      ORDER BY starts_at DESC
      LIMIT 1
      FOR UPDATE`,
    [cycleType],
  );
  return result.rows[0] ?? null;
}

async function insertPeriod(
  client: Queryable,
  cycleType: LeaderboardCycleType,
  startsAt: Date,
  endsAt: Date,
  status: LeaderboardPeriodStatus,
  previousPeriodId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO daily007_v2_leaderboard_periods
       (cycle_type, starts_at, ends_at, status, previous_period_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (cycle_type, starts_at) DO NOTHING`,
    [cycleType, startsAt.toISOString(), endsAt.toISOString(), status, previousPeriodId],
  );
}

async function nextPeriodFor(
  client: Queryable,
  previous: PeriodRow,
): Promise<PeriodRow> {
  const existing = await client.query<PeriodRow>(
    `SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,
            final_standings, payout_configuration
       FROM daily007_v2_leaderboard_periods
      WHERE previous_period_id = $1
      FOR UPDATE`,
    [previous.id],
  );
  if (existing.rows[0]) return existing.rows[0];

  const bounds = nextLeaderboardPeriodWindow(
    previous.cycle_type,
    asDate(previous.ends_at),
  );
  await insertPeriod(
    client,
    previous.cycle_type,
    bounds.startsAt,
    bounds.endsAt,
    "pending_activation",
    previous.id,
  );
  const created = await client.query<PeriodRow>(
    `SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,
            final_standings, payout_configuration
       FROM daily007_v2_leaderboard_periods
      WHERE previous_period_id = $1`,
    [previous.id],
  );
  const next = created.rows[0];
  if (!next) {
    throw new Error("Could not create the next leaderboard period.");
  }
  return next;
}

async function reconcileCycle(
  client: SqlClient,
  cycleType: LeaderboardCycleType,
  now: Date,
): Promise<void> {
  const nowMs = now.getTime();
  for (let step = 0; step < MAX_PERIOD_CATCHUP; step += 1) {
    let period = await newestPeriod(client, cycleType);
    if (!period) {
      const current = leaderboardPeriodWindow(cycleType, now);
      await insertPeriod(client, cycleType, current.startsAt, current.endsAt, "active", null);
      continue;
    }

    const endsAt = asDate(period.ends_at);
    if (period.status === "active") {
      if (nowMs < endsAt.getTime()) return;
      await client.query(
        `UPDATE daily007_v2_leaderboard_periods
            SET status = 'pending_approval'
          WHERE id = $1 AND status = 'active'`,
        [period.id],
      );
      period = { ...period, status: "pending_approval" };
    }

    if (period.status === "pending_approval") {
      await nextPeriodFor(client, period);
      continue;
    }

    if (period.status === "pending_activation") {
      if (nowMs < endsAt.getTime()) return;
      await client.query(
        `UPDATE daily007_v2_leaderboard_periods
            SET status = 'pending_approval'
          WHERE id = $1 AND status = 'pending_activation'`,
        [period.id],
      );
      continue;
    }

    if (period.status === "finalized") {
      const next = nextLeaderboardPeriodWindow(cycleType, endsAt);
      const status = nowMs < next.endsAt.getTime() ? "active" : "pending_approval";
      await insertPeriod(client, cycleType, next.startsAt, next.endsAt, status, period.id);
      continue;
    }
  }

  throw new Error(`Leaderboard ${cycleType} cycle catch-up exceeded its safety limit.`);
}

export async function reconcileDaily007LeaderboardPeriods(now = new Date()): Promise<void> {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("Leaderboard reconciliation date must be valid.");
  }
  await transaction(async (client) => {
    for (const cycleType of CYCLE_TYPES) {
      await reconcileCycle(client, cycleType, now);
    }
  });
}

async function queryStandings(
  queryable: Queryable,
  startsAt: Date,
  endsAt: Date,
): Promise<LeaderboardStanding[]> {
  const result = await queryable.query<RawStanding>(
    `SELECT a.user_id AS "userId",
            u.name AS name,
            COALESCE(SUM(a.prize_coins), 0)::text AS points,
            COALESCE(SUM(a.prize_coins), 0)::text AS earnings,
            COUNT(*) FILTER (WHERE a.rank = 1)::text AS wins,
            COALESCE(SUM(a.kills), 0)::text AS kills,
            COUNT(*)::text AS matches
       FROM daily007_v2_result_awards a
       JOIN daily007_v2_matches m ON m.id = a.match_id
       JOIN daily007_v2_users u ON u.id = a.user_id
      WHERE m.starts_at >= $1 AND m.starts_at < $2
      GROUP BY a.user_id, u.name
      ORDER BY SUM(a.prize_coins) DESC,
               COUNT(*) FILTER (WHERE a.rank = 1) DESC,
               COALESCE(SUM(a.kills), 0) DESC,
               LOWER(u.name) ASC,
               a.user_id ASC
      LIMIT 100`,
    [startsAt.toISOString(), endsAt.toISOString()],
  );

  return rankLeaderboardStandings(result.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    points: parseSafeInteger(row.points, "Leaderboard score"),
    earnings: parseSafeInteger(row.earnings, "Leaderboard earnings"),
    wins: parseSafeInteger(row.wins, "Leaderboard wins"),
    kills: parseSafeInteger(row.kills, "Leaderboard kills"),
    matches: parseSafeInteger(row.matches, "Leaderboard match count"),
  })));
}

function savedStandings(value: unknown): LeaderboardStanding[] | null {
  if (!Array.isArray(value)) return null;
  return value as LeaderboardStanding[];
}

async function periodView(
  period: PeriodRow,
  queryable: Queryable = pool,
): Promise<Record<string, unknown>> {
  const { startsAt, endsAt } = periodDates(period);
  const standings = period.status === "finalized"
    ? savedStandings(period.final_standings) ?? await queryStandings(queryable, startsAt, endsAt)
    : await queryStandings(queryable, startsAt, endsAt);
  return {
    id: period.id,
    cycleType: period.cycle_type,
    status: period.status,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    standings,
  };
}

async function visiblePeriod(
  cycleType: LeaderboardCycleType,
): Promise<Record<string, unknown>> {
  const result = await pool.query<PeriodRow>(
    `SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,
            final_standings, payout_configuration
       FROM daily007_v2_leaderboard_periods
      WHERE cycle_type = $1
      ORDER BY starts_at DESC
      LIMIT 600`,
    [cycleType],
  );
  const periods = result.rows;
  const selected =
    periods.find((period) => period.status === "active") ??
    periods.find((period) => period.status === "pending_approval") ??
    periods.find((period) => period.status === "pending_activation") ??
    periods.find((period) => period.status === "finalized");
  if (!selected) {
    throw new Error(`No ${cycleType} leaderboard period exists after reconciliation.`);
  }
  return periodView(selected);
}

export async function getDaily007Leaderboards(): Promise<{
  weekly: Record<string, unknown>;
  monthly: Record<string, unknown>;
}> {
  await reconcileDaily007LeaderboardPeriods();
  const [weekly, monthly] = await Promise.all([
    visiblePeriod("weekly"),
    visiblePeriod("monthly"),
  ]);
  return { weekly, monthly };
}

export async function getDaily007LeaderboardApprovalQueue(): Promise<{
  periods: Record<string, unknown>[];
}> {
  await reconcileDaily007LeaderboardPeriods();
  const result = await pool.query<PeriodRow>(
    `SELECT period.id, period.cycle_type, period.starts_at, period.ends_at,
            period.status, period.previous_period_id, period.final_standings,
            period.payout_configuration
       FROM daily007_v2_leaderboard_periods period
       LEFT JOIN daily007_v2_leaderboard_periods previous
         ON previous.id = period.previous_period_id
      WHERE period.status = 'pending_approval'
        AND (period.previous_period_id IS NULL OR previous.status = 'finalized')
      ORDER BY period.ends_at ASC, period.cycle_type ASC
      LIMIT 100`,
  );
  return {
    periods: await Promise.all(result.rows.map((period) => periodView(period))),
  };
}

export async function approveDaily007LeaderboardPeriod(
  periodId: string,
  adminId: string,
  payouts: LeaderboardPayout[],
): Promise<{
  periodId: string;
  status: "finalized";
  payouts: PayoutReceipt[];
  nextPeriodStatus: LeaderboardPeriodStatus;
}> {
  await reconcileDaily007LeaderboardPeriods();
  return transaction(async (client) => {
    const locked = await client.query<PeriodRow>(
      `SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,
              final_standings, payout_configuration
         FROM daily007_v2_leaderboard_periods
        WHERE id = $1
        FOR UPDATE`,
      [periodId],
    );
    const period = locked.rows[0];
    if (!period) {
      throw Object.assign(new Error("Leaderboard period not found."), { status: 404 });
    }
    if (period.status !== "pending_approval") {
      throw Object.assign(new Error("This leaderboard period is not awaiting approval."), { status: 409 });
    }

    if (period.previous_period_id) {
      const previous = await client.query<{ status: LeaderboardPeriodStatus }>(
        `SELECT status FROM daily007_v2_leaderboard_periods WHERE id = $1 FOR UPDATE`,
        [period.previous_period_id],
      );
      if (previous.rows[0]?.status !== "finalized") {
        throw Object.assign(new Error("Approve earlier cycles first."), { status: 409 });
      }
    }

    const { startsAt, endsAt } = periodDates(period);
    const now = new Date();
    if (endsAt.getTime() > now.getTime()) {
      throw Object.assign(new Error("This leaderboard period has not ended yet."), { status: 409 });
    }

    const standings = await queryStandings(client, startsAt, endsAt);
    const sortedPayouts = [...payouts].sort((a, b) => a.rank - b.rank);
    if (standings.length > 0 && sortedPayouts.length === 0) {
      throw Object.assign(new Error("Set at least one coin payout for a ranked player."), { status: 400 });
    }
    if (
      sortedPayouts.length > 10 ||
      sortedPayouts.some((payout, index) =>
        !Number.isSafeInteger(payout.rank) ||
        payout.rank < 1 ||
        payout.rank > 100 ||
        !Number.isSafeInteger(payout.coins) ||
        payout.coins < 1 ||
        payout.coins > MAX_INT ||
        (index > 0 && sortedPayouts[index - 1]?.rank === payout.rank),
      )
    ) {
      throw Object.assign(new Error("Payout ranks and coin amounts must be valid and unique."), { status: 400 });
    }

    const receipts: PayoutReceipt[] = [];
    for (const payout of sortedPayouts) {
      const standing = standings.find((item) => item.rank === payout.rank);
      if (!standing) {
        throw Object.assign(new Error(`There is no player at rank ${payout.rank}.`), { status: 400 });
      }
      const account = await client.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [standing.userId],
      );
      const balance = account.rows[0]?.wallet_coins;
      if (balance === undefined) {
        throw Object.assign(new Error("A leaderboard player account no longer exists."), { status: 409 });
      }
      const walletCoins = balance + payout.coins;
      if (!Number.isSafeInteger(walletCoins) || walletCoins > MAX_INT) {
        throw Object.assign(new Error(`Rank ${payout.rank}'s wallet would exceed its supported range.`), { status: 409 });
      }

      await client.query(
        "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
        [standing.userId, walletCoins],
      );
      await client.query(
        `INSERT INTO daily007_v2_wallet_ledger
           (user_id, amount, balance_after, reason, idempotency_key, details)
         VALUES ($1, $2, $3, 'leaderboard_prize', $4, $5::jsonb)`,
        [
          standing.userId,
          payout.coins,
          walletCoins,
          `leaderboard-cycle:${period.id}:rank:${payout.rank}`,
          JSON.stringify({
            periodId: period.id,
            cycleType: period.cycle_type,
            rank: payout.rank,
            points: standing.points,
            earnings: standing.earnings,
            wins: standing.wins,
            kills: standing.kills,
            matches: standing.matches,
          }),
        ],
      );
      receipts.push({
        rank: payout.rank,
        userId: standing.userId,
        coins: payout.coins,
        walletCoins,
      });
    }

    await client.query(
      `UPDATE daily007_v2_leaderboard_periods
          SET status = 'finalized',
              approved_by = $2,
              approved_at = $3,
              final_standings = $4::jsonb,
              payout_configuration = $5::jsonb
        WHERE id = $1`,
      [
        period.id,
        adminId,
        now.toISOString(),
        JSON.stringify(standings),
        JSON.stringify(sortedPayouts),
      ],
    );

    let next = await nextPeriodFor(client, { ...period, status: "finalized" });
    if (next.status === "pending_activation") {
      const nextEndsAt = asDate(next.ends_at);
      const nextStatus: LeaderboardPeriodStatus =
        nextEndsAt.getTime() > now.getTime() ? "active" : "pending_approval";
      await client.query(
        `UPDATE daily007_v2_leaderboard_periods
            SET status = $2
          WHERE id = $1 AND status = 'pending_activation'`,
        [next.id, nextStatus],
      );
      next = { ...next, status: nextStatus };
    } else if (next.status === "pending_approval") {
      await nextPeriodFor(client, next);
    }

    return {
      periodId: period.id,
      status: "finalized",
      payouts: receipts,
      nextPeriodStatus: next.status,
    };
  });
}

async function schedulerSweep(): Promise<void> {
  if (sweepRunning) return;
  sweepRunning = true;
  try {
    await reconcileDaily007LeaderboardPeriods();
  } catch (error) {
    logger.error({ err: error }, "Daily007 leaderboard period sweep failed");
  } finally {
    sweepRunning = false;
  }
}

export function startDaily007LeaderboardScheduler(): void {
  if (schedulerTimer) return;
  void schedulerSweep();
  schedulerTimer = setInterval(() => void schedulerSweep(), SCHEDULER_INTERVAL_MS);
  schedulerTimer.unref();
  logger.info(
    { intervalMs: SCHEDULER_INTERVAL_MS },
    "Daily007 weekly and monthly leaderboard scheduler started",
  );
}