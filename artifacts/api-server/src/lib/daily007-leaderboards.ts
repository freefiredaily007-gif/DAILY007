import { pool } from "@workspace/db";
import { logger } from "./logger";
import {
  leaderboardPeriodWindow,
  leaderboardRewardDescription,
  leaderboardRewardRecipients,
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
  approved_by?: string | null;
  approved_at?: Date | string | null;
};

type RewardSettingsRow = {
  cycle_type: LeaderboardCycleType;
  first_place_coins: number;
  second_place_coins: number;
  third_place_coins: number;
};

type RewardAmounts = {
  firstPlaceCoins: number;
  secondPlaceCoins: number;
  thirdPlaceCoins: number;
};

type PeriodRangeRow = {
  starts_at: Date | string;
  ends_at: Date | string;
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
  const rewards = await rewardSettingsForCycle(client, cycleType);
  await client.query(
    `INSERT INTO daily007_v2_leaderboard_periods
       (cycle_type, starts_at, ends_at, status, previous_period_id, payout_configuration)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (cycle_type, starts_at) DO NOTHING`,
    [
      cycleType,
      startsAt.toISOString(),
      endsAt.toISOString(),
      status,
      previousPeriodId,
      JSON.stringify(rewards),
    ],
  );
}

async function ensureRewardSettings(client: Queryable): Promise<void> {
  await client.query(
    `INSERT INTO daily007_v2_leaderboard_reward_settings (cycle_type)
     VALUES ('weekly'), ('monthly')
     ON CONFLICT (cycle_type) DO NOTHING`,
  );
}

function amountsToPayouts(amounts: RewardAmounts): LeaderboardPayout[] {
  return [
    { rank: 1, coins: amounts.firstPlaceCoins },
    { rank: 2, coins: amounts.secondPlaceCoins },
    { rank: 3, coins: amounts.thirdPlaceCoins },
  ];
}

function normalizeRewards(value: unknown): LeaderboardPayout[] {
  const entries = Array.isArray(value) ? value : [];
  return [1, 2, 3].map((rank) => {
    const entry = entries.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        (candidate as Record<string, unknown>).rank === rank,
    ) as Record<string, unknown> | undefined;
    const coins = entry?.coins ?? 0;
    if (typeof coins !== "number" && typeof coins !== "string") {
      throw new RangeError(`Leaderboard rank ${rank} has invalid reward coins.`);
    }
    const parsed = parseSafeInteger(coins, `Leaderboard rank ${rank} reward`);
    if (parsed > MAX_INT) {
      throw new RangeError(`Leaderboard rank ${rank} reward is too large.`);
    }
    return { rank, coins: parsed };
  });
}

async function rewardSettingsForCycle(
  client: Queryable,
  cycleType: LeaderboardCycleType,
): Promise<LeaderboardPayout[]> {
  await ensureRewardSettings(client);
  const result = await client.query<RewardSettingsRow>(
    `SELECT cycle_type, first_place_coins, second_place_coins, third_place_coins
       FROM daily007_v2_leaderboard_reward_settings
      WHERE cycle_type = $1`,
    [cycleType],
  );
  const settings = result.rows[0];
  if (!settings) throw new Error(`Missing ${cycleType} leaderboard reward settings.`);
  return amountsToPayouts({
    firstPlaceCoins: settings.first_place_coins,
    secondPlaceCoins: settings.second_place_coins,
    thirdPlaceCoins: settings.third_place_coins,
  });
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
    "active",
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
      return;
    }

    if (period.status === "finalized") {
      period = await nextPeriodFor(client, period);
      if (period.status !== "active") {
        await client.query(
          `UPDATE daily007_v2_leaderboard_periods
              SET status = 'active'
            WHERE id = $1 AND status <> 'finalized'`,
          [period.id],
        );
      }
      continue;
    }

    const endsAt = asDate(period.ends_at);

    if (period.status === "pending_activation" && period.previous_period_id) {
      const previousResult = await client.query<PeriodRow>(
        `SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,
                final_standings, payout_configuration
           FROM daily007_v2_leaderboard_periods
          WHERE id = $1
          FOR UPDATE`,
        [period.previous_period_id],
      );
      const previous = previousResult.rows[0];
      if (previous && previous.status !== "finalized") {
        if (asDate(previous.ends_at).getTime() > nowMs) return;
        if (previous.status !== "pending_approval") {
          await prepareEndedPeriod(client, previous, now);
        }
      }
      await client.query(
        `UPDATE daily007_v2_leaderboard_periods
            SET status = 'active'
          WHERE id = $1 AND status = 'pending_activation'`,
        [period.id],
      );
      period = { ...period, status: "active" };
    }

    if (period.status === "pending_approval") {
      if (nowMs < endsAt.getTime()) return;
      const next = await nextPeriodFor(client, period);
      if (next.status !== "active") {
        await client.query(
          `UPDATE daily007_v2_leaderboard_periods
              SET status = 'active'
            WHERE id = $1 AND status <> 'finalized'`,
          [next.id],
        );
      }
      return;
    }

    if (nowMs < endsAt.getTime()) return;
    const awaitingApproval = await prepareEndedPeriod(client, period, now);
    const next = await nextPeriodFor(client, awaitingApproval);
    if (next.status !== "active") {
      await client.query(
        `UPDATE daily007_v2_leaderboard_periods
            SET status = 'active'
          WHERE id = $1 AND status <> 'finalized'`,
        [next.id],
      );
    }
    return;
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
       LIMIT 20`,
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

async function prepareEndedPeriod(
  client: SqlClient,
  period: PeriodRow,
  endedAt: Date,
): Promise<PeriodRow> {
  if (period.status === "finalized") return period;
  if (period.status === "pending_approval" && savedStandings(period.final_standings)) {
    return period;
  }
  const { startsAt, endsAt } = periodDates(period);
  if (endsAt.getTime() > endedAt.getTime()) {
    throw Object.assign(new Error("This leaderboard cycle has not ended yet."), { status: 409 });
  }

  const standings = await queryStandings(client, startsAt, endsAt);
  const rewards = normalizeRewards(period.payout_configuration);
  const normalizedStandings = JSON.stringify(standings);
  const normalizedRewards = JSON.stringify(rewards);
  await client.query(
    `UPDATE daily007_v2_leaderboard_periods
        SET status = 'pending_approval',
            final_standings = $2::jsonb,
            payout_configuration = $3::jsonb
      WHERE id = $1`,
    [period.id, normalizedStandings, normalizedRewards],
  );
  logger.info(
    { cycleType: period.cycle_type, periodId: period.id },
    "Daily007 leaderboard cycle is awaiting Full Admin approval",
  );
  return {
    ...period,
    status: "pending_approval",
    final_standings: standings,
    payout_configuration: rewards,
  };
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
  const standings = period.status === "finalized" || period.status === "pending_approval"
    ? savedStandings(period.final_standings) ?? await queryStandings(queryable, startsAt, endsAt)
    : await queryStandings(queryable, startsAt, endsAt);
  return {
    id: period.id,
    cycleType: period.cycle_type,
    status: period.status,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    standings,
    rewards: normalizeRewards(period.payout_configuration),
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

export async function getDaily007LeaderboardApprovals(): Promise<{
  periods: Record<string, unknown>[];
}> {
  await reconcileDaily007LeaderboardPeriods();
  const result = await pool.query<PeriodRow>(
    `SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,
            final_standings, payout_configuration
       FROM daily007_v2_leaderboard_periods
      WHERE status = 'pending_approval'
      ORDER BY ends_at DESC
      LIMIT 100`,
  );
  return {
    periods: await Promise.all(result.rows.map((period) => periodView(period))),
  };
}

export async function approveDaily007LeaderboardPeriod(
  periodId: string,
  adminId: string,
  approvedAt = new Date(),
): Promise<{
  periodId: string;
  cycleType: LeaderboardCycleType;
  alreadyApproved: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  standings: LeaderboardStanding[];
  rewards: LeaderboardPayout[];
  payouts: {
    rank: number;
    userId: string;
    name: string;
    coins: number;
    balanceAfter: number;
  }[];
}> {
  if (!Number.isFinite(approvedAt.getTime())) {
    throw new RangeError("Leaderboard approval date must be valid.");
  }
  return transaction(async (client) => {
    const result = await client.query<PeriodRow>(
      `SELECT id, cycle_type, starts_at, ends_at, status, previous_period_id,
              final_standings, payout_configuration, approved_by, approved_at
         FROM daily007_v2_leaderboard_periods
        WHERE id = $1
        FOR UPDATE`,
      [periodId],
    );
    const period = result.rows[0];
    if (!period) {
      throw Object.assign(new Error("Leaderboard cycle not found."), { status: 404 });
    }

    const standings = savedStandings(period.final_standings) ?? [];
    const rewards = normalizeRewards(period.payout_configuration);
    if (period.status === "finalized") {
      return {
        periodId: period.id,
        cycleType: period.cycle_type,
        alreadyApproved: true,
        approvedBy: period.approved_by ?? null,
        approvedAt: period.approved_at
          ? asDate(period.approved_at).toISOString()
          : null,
        standings,
        rewards,
        payouts: [],
      };
    }
    if (period.status !== "pending_approval") {
      throw Object.assign(
        new Error("This leaderboard cycle is not awaiting approval."),
        { status: 409 },
      );
    }
    if (asDate(period.ends_at).getTime() > approvedAt.getTime()) {
      throw Object.assign(
        new Error("This leaderboard cycle has not ended yet."),
        { status: 409 },
      );
    }
    if (!savedStandings(period.final_standings)) {
      throw Object.assign(
        new Error("The leaderboard standings snapshot is missing."),
        { status: 409 },
      );
    }

    const recipients = leaderboardRewardRecipients(standings, rewards);
    const payouts: {
      rank: number;
      userId: string;
      name: string;
      coins: number;
      balanceAfter: number;
    }[] = [];
    for (const recipient of recipients) {
      const account = await client.query<{ wallet_coins: number | string }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [recipient.userId],
      );
      const currentBalance = account.rows[0]?.wallet_coins;
      if (currentBalance === undefined) {
        throw Object.assign(
          new Error("A leaderboard winner account no longer exists."),
          { status: 409 },
        );
      }
      const walletCoins = parseSafeInteger(currentBalance, "Winner wallet balance") +
        recipient.coins;
      if (!Number.isSafeInteger(walletCoins) || walletCoins > MAX_INT) {
        throw Object.assign(
          new Error(`Rank ${recipient.rank}'s wallet would exceed its supported range.`),
          { status: 409 },
        );
      }

      const reason = leaderboardRewardDescription(period.cycle_type, recipient.rank);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO daily007_v2_wallet_ledger
           (user_id, amount, balance_after, reason, idempotency_key, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          recipient.userId,
          recipient.coins,
          walletCoins,
          reason,
          `leaderboard-cycle:${period.id}:rank:${recipient.rank}`,
          JSON.stringify({
            description: reason,
            periodId: period.id,
            cycleType: period.cycle_type,
            rank: recipient.rank,
            points: standings.find((standing) => standing.rank === recipient.rank)?.points ?? 0,
          }),
        ],
      );
      if (!inserted.rows[0]) {
        throw Object.assign(
          new Error("A payout already exists for this leaderboard rank."),
          { status: 409 },
        );
      }

      await client.query(
        "UPDATE daily007_v2_users SET wallet_coins = $2 WHERE id = $1",
        [recipient.userId, walletCoins],
      );
      payouts.push({
        ...recipient,
        name: standings.find((standing) => standing.userId === recipient.userId)?.name ?? "",
        balanceAfter: walletCoins,
      });
    }

    const finalized = await client.query<{ id: string }>(
      `UPDATE daily007_v2_leaderboard_periods
          SET status = 'finalized',
              approved_by = $2,
              approved_at = $3,
              settled_at = $3,
              final_standings = $4::jsonb,
              payout_configuration = $5::jsonb
        WHERE id = $1 AND status = 'pending_approval'
        RETURNING id`,
      [
        period.id,
        adminId,
        approvedAt.toISOString(),
        JSON.stringify(standings),
        JSON.stringify(rewards),
      ],
    );
    if (!finalized.rows[0]) {
      throw Object.assign(
        new Error("This leaderboard cycle changed before approval completed."),
        { status: 409 },
      );
    }

    logger.info(
      { cycleType: period.cycle_type, periodId: period.id, adminId, payoutCount: payouts.length },
      "Daily007 leaderboard cycle approved and paid",
    );
    return {
      periodId: period.id,
      cycleType: period.cycle_type,
      alreadyApproved: false,
      approvedBy: adminId,
      approvedAt: approvedAt.toISOString(),
      standings,
      rewards,
      payouts,
    };
  });
}

async function rewardScheduleView(
  client: Queryable,
  cycleType: LeaderboardCycleType,
): Promise<RewardAmounts & {
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
}> {
  const settingsResult = await client.query<RewardSettingsRow>(
    `SELECT cycle_type, first_place_coins, second_place_coins, third_place_coins
       FROM daily007_v2_leaderboard_reward_settings
      WHERE cycle_type = $1`,
    [cycleType],
  );
  const settings = settingsResult.rows[0];
  if (!settings) throw new Error(`Missing ${cycleType} leaderboard reward settings.`);

  const periodResult = await client.query<PeriodRangeRow>(
    `SELECT starts_at, ends_at
       FROM daily007_v2_leaderboard_periods
      WHERE cycle_type = $1
        AND status <> 'finalized'
        AND ends_at > now()
      ORDER BY starts_at DESC
      LIMIT 1`,
    [cycleType],
  );
  const currentPeriod = periodResult.rows[0];
  return {
    firstPlaceCoins: settings.first_place_coins,
    secondPlaceCoins: settings.second_place_coins,
    thirdPlaceCoins: settings.third_place_coins,
    currentPeriodStartsAt: currentPeriod ? asDate(currentPeriod.starts_at).toISOString() : null,
    currentPeriodEndsAt: currentPeriod ? asDate(currentPeriod.ends_at).toISOString() : null,
  };
}

async function leaderboardRewardSettingsView(client: Queryable) {
  await ensureRewardSettings(client);
  const [weekly, monthly] = await Promise.all([
    rewardScheduleView(client, "weekly"),
    rewardScheduleView(client, "monthly"),
  ]);
  return { weekly, monthly };
}

export async function getDaily007LeaderboardRewardSettings() {
  return transaction(leaderboardRewardSettingsView);
}

export async function updateDaily007LeaderboardRewardSettings(
  adminId: string,
  settings: { weekly: RewardAmounts; monthly: RewardAmounts },
) {
  return transaction(async (client) => {
    await ensureRewardSettings(client);
    const now = new Date();
    for (const cycleType of CYCLE_TYPES) {
      const amounts = settings[cycleType];
      const values = [
        amounts.firstPlaceCoins,
        amounts.secondPlaceCoins,
        amounts.thirdPlaceCoins,
      ];
      if (values.some((coins) =>
        !Number.isSafeInteger(coins) || coins < 0 || coins > MAX_INT
      )) {
        throw Object.assign(
          new Error("Reward amounts must be nonnegative whole numbers within the wallet limit."),
          { status: 400 },
        );
      }

      const rewards = amountsToPayouts(amounts);
      await client.query(
        `INSERT INTO daily007_v2_leaderboard_reward_settings
           (cycle_type, first_place_coins, second_place_coins, third_place_coins,
            updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (cycle_type) DO UPDATE SET
           first_place_coins = EXCLUDED.first_place_coins,
           second_place_coins = EXCLUDED.second_place_coins,
           third_place_coins = EXCLUDED.third_place_coins,
           updated_by = EXCLUDED.updated_by,
           updated_at = EXCLUDED.updated_at`,
        [cycleType, ...values, adminId, now.toISOString()],
      );
      await client.query(
        `UPDATE daily007_v2_leaderboard_periods
            SET payout_configuration = $2::jsonb
          WHERE cycle_type = $1
            AND status IN ('active', 'pending_activation', 'pending_approval')
            AND ends_at > $3`,
        [cycleType, JSON.stringify(rewards), now.toISOString()],
      );
    }
    return leaderboardRewardSettingsView(client);
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