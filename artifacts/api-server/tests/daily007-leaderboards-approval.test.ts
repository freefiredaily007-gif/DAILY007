import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import {
  leaderboardPeriodWindow,
  type LeaderboardCycleType,
} from "../src/lib/daily007-leaderboard-core";
import {
  getDaily007Leaderboards,
  reconcileDaily007LeaderboardPeriods,
} from "../src/lib/daily007-leaderboards";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007LeaderboardRouter from "../src/routes/daily007-leaderboards";
import {
  daily007LeaderboardTestDb,
  TEST_FULL_ADMIN_ID,
  TEST_MONTHLY_PERIOD_ID,
  TEST_PLAYER_FOUR_ID,
  TEST_PLAYER_ONE_ID,
  TEST_PLAYER_THREE_ID,
  TEST_PLAYER_TWO_ID,
  TEST_TOURNAMENT_ADMIN_ID,
  TEST_WEEKLY_PERIOD_ID,
} from "./support/daily007-leaderboard-test-db";

const TEST_AUTH_SECRET = "daily007-leaderboard-tests-only-secret-value-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };
type StandingSeed = {
  rank: number;
  userId: string;
  name: string;
  points: number;
  earnings: number;
  wins: number;
  kills: number;
  matches: number;
};
type RewardSeed = { rank: number; coins: number };
type AwardSeed = {
  matchId: string;
  startsAt: Date;
  userId: string;
  rank: number;
  kills: number;
  coins: number;
};

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007LeaderboardRouter);
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

async function call(
  origin: string,
  actorId: string,
  path: string,
  method: "GET" | "POST",
): Promise<JsonResult> {
  const token = makeToken(actorId, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: await response.json() };
}

function period(
  id: string,
  cycleType: LeaderboardCycleType,
  startsAt: Date,
  endsAt: Date,
  status: "active" | "pending_approval",
  standings: StandingSeed[] = [],
  rewards: RewardSeed[] = [],
  previousPeriodId: string | null = null,
) {
  daily007LeaderboardTestDb.seedPeriod({
    id,
    cycle_type: cycleType,
    starts_at: startsAt,
    ends_at: endsAt,
    status,
    previous_period_id: previousPeriodId,
    final_standings: standings,
    payout_configuration: rewards,
  });
}

function addAward(seed: AwardSeed, index: number): void {
  daily007LeaderboardTestDb.seedMatch(seed.matchId, seed.startsAt);
  daily007LeaderboardTestDb.seedAward({
    match_id: seed.matchId,
    user_id: seed.userId,
    rank: seed.rank,
    kills: seed.kills,
    prize_coins: seed.coins,
    created_at: new Date(seed.startsAt.getTime() + (index + 100) * 86_400_000),
  });
}

function expectedStandings(
  events: AwardSeed[],
  startsAt: Date,
  endsAt: Date,
): { userId: string; points: number; rank: number }[] {
  const totals = new Map<string, { points: number; wins: number; kills: number; name: string }>();
  const names = new Map([
    [TEST_PLAYER_ONE_ID, "Alpha"],
    [TEST_PLAYER_TWO_ID, "Bravo"],
    [TEST_PLAYER_THREE_ID, "Charlie"],
    [TEST_PLAYER_FOUR_ID, "Delta"],
  ]);
  for (const event of events) {
    if (event.startsAt < startsAt || event.startsAt >= endsAt) continue;
    const current = totals.get(event.userId) ?? {
      points: 0,
      wins: 0,
      kills: 0,
      name: names.get(event.userId) ?? "",
    };
    current.points += event.coins;
    current.wins += event.rank === 1 ? 1 : 0;
    current.kills += event.kills;
    totals.set(event.userId, current);
  }
  return [...totals.entries()]
    .sort(([leftId, left], [rightId, right]) =>
      right.points - left.points ||
      right.wins - left.wins ||
      right.kills - left.kills ||
      left.name.toLowerCase().localeCompare(right.name.toLowerCase()) ||
      leftId.localeCompare(rightId),
    )
    .map(([userId, value], index) => ({
      userId,
      points: value.points,
      rank: index + 1,
    }));
}

const weeklySnapshot: StandingSeed[] = [
  { rank: 1, userId: TEST_PLAYER_ONE_ID, name: "Alpha", points: 700, earnings: 700, wins: 3, kills: 12, matches: 4 },
  { rank: 2, userId: TEST_PLAYER_TWO_ID, name: "Bravo", points: 500, earnings: 500, wins: 2, kills: 9, matches: 4 },
  { rank: 3, userId: TEST_PLAYER_THREE_ID, name: "Charlie", points: 300, earnings: 300, wins: 1, kills: 4, matches: 3 },
  { rank: 4, userId: TEST_PLAYER_FOUR_ID, name: "Delta", points: 100, earnings: 100, wins: 0, kills: 2, matches: 2 },
];
const monthlySnapshot: StandingSeed[] = [
  { rank: 1, userId: TEST_PLAYER_THREE_ID, name: "Charlie", points: 900, earnings: 900, wins: 4, kills: 15, matches: 6 },
  { rank: 2, userId: TEST_PLAYER_FOUR_ID, name: "Delta", points: 500, earnings: 500, wins: 2, kills: 10, matches: 5 },
  { rank: 3, userId: TEST_PLAYER_TWO_ID, name: "Bravo", points: 350, earnings: 350, wins: 1, kills: 8, matches: 4 },
  { rank: 4, userId: TEST_PLAYER_ONE_ID, name: "Alpha", points: 150, earnings: 150, wins: 0, kills: 3, matches: 2 },
];

function seedOpenPeriods(now: Date): void {
  for (const [cycleType, id] of [
    ["weekly", "73000000-0000-4000-8000-000000000001"],
    ["monthly", "73000000-0000-4000-8000-000000000002"],
  ] as const) {
    const window = leaderboardPeriodWindow(cycleType, now);
    period(id, cycleType, window.startsAt, window.endsAt, "active", [], [
      { rank: 1, coins: 50 },
      { rank: 2, coins: 40 },
      { rank: 3, coins: 30 },
    ]);
  }
}

function seedPendingAndOpenPeriods(now: Date): void {
  seedOpenPeriods(now);
  for (const [cycleType, id, standings, rewards] of [
    [
      "weekly",
      TEST_WEEKLY_PERIOD_ID,
      weeklySnapshot,
      [
        { rank: 1, coins: 50 },
        { rank: 2, coins: 40 },
        { rank: 3, coins: 0 },
        { rank: 4, coins: 999 },
      ],
    ],
    [
      "monthly",
      TEST_MONTHLY_PERIOD_ID,
      monthlySnapshot,
      [
        { rank: 1, coins: 25 },
        { rank: 2, coins: 0 },
        { rank: 3, coins: 5 },
        { rank: 4, coins: 999 },
      ],
    ],
  ] as const) {
    const current = leaderboardPeriodWindow(cycleType, now);
    const previous = leaderboardPeriodWindow(
      cycleType,
      new Date(current.startsAt.getTime() - 1),
    );
    period(
      id,
      cycleType,
      previous.startsAt,
      previous.endsAt,
      "pending_approval",
      standings,
      rewards,
    );
  }
}

test("weekly and monthly standings use the scheduled match start inside each IST cycle", async () => {
  daily007LeaderboardTestDb.reset();
  const now = new Date();
  const weeklyWindow = leaderboardPeriodWindow("weekly", now);
  const monthlyWindow = leaderboardPeriodWindow("monthly", now);
  period(
    "73000000-0000-4000-8000-000000000011",
    "weekly",
    weeklyWindow.startsAt,
    weeklyWindow.endsAt,
    "active",
    [],
    [{ rank: 1, coins: 50 }],
  );
  period(
    "73000000-0000-4000-8000-000000000012",
    "monthly",
    monthlyWindow.startsAt,
    monthlyWindow.endsAt,
    "active",
    [],
    [{ rank: 1, coins: 90 }],
  );

  const events: AwardSeed[] = [
    {
      matchId: "74000000-0000-4000-8000-000000000001",
      startsAt: new Date(weeklyWindow.startsAt.getTime() + 60_000),
      userId: TEST_PLAYER_ONE_ID,
      rank: 1,
      kills: 5,
      coins: 70,
    },
    {
      matchId: "74000000-0000-4000-8000-000000000002",
      startsAt: new Date(weeklyWindow.startsAt.getTime() - 1),
      userId: TEST_PLAYER_TWO_ID,
      rank: 1,
      kills: 8,
      coins: 900,
    },
    {
      matchId: "74000000-0000-4000-8000-000000000003",
      startsAt: new Date(weeklyWindow.endsAt.getTime()),
      userId: TEST_PLAYER_THREE_ID,
      rank: 1,
      kills: 6,
      coins: 500,
    },
    {
      matchId: "74000000-0000-4000-8000-000000000004",
      startsAt: new Date(monthlyWindow.startsAt.getTime() + 60_000),
      userId: TEST_PLAYER_TWO_ID,
      rank: 2,
      kills: 2,
      coins: 60,
    },
    {
      matchId: "74000000-0000-4000-8000-000000000005",
      startsAt: new Date(monthlyWindow.startsAt.getTime() - 1),
      userId: TEST_PLAYER_FOUR_ID,
      rank: 1,
      kills: 10,
      coins: 800,
    },
    {
      matchId: "74000000-0000-4000-8000-000000000006",
      startsAt: new Date(monthlyWindow.endsAt.getTime()),
      userId: TEST_PLAYER_ONE_ID,
      rank: 1,
      kills: 3,
      coins: 200,
    },
  ];
  events.forEach(addAward);

  const response = await getDaily007Leaderboards();
  const weekly = response.weekly as { standings: { userId: string; points: number; rank: number }[] };
  const monthly = response.monthly as { standings: { userId: string; points: number; rank: number }[] };
  assert.deepEqual(
    weekly.standings.map(({ userId, points, rank }) => ({ userId, points, rank })),
    expectedStandings(events, weeklyWindow.startsAt, weeklyWindow.endsAt),
  );
  assert.deepEqual(
    monthly.standings.map(({ userId, points, rank }) => ({ userId, points, rank })),
    expectedStandings(events, monthlyWindow.startsAt, monthlyWindow.endsAt),
  );
});

test("ended weekly and monthly cycles snapshot standings and wait for approval without paying", async () => {
  daily007LeaderboardTestDb.reset();
  const now = new Date("2026-10-04T18:30:00.000Z");
  const expired: { cycleType: LeaderboardCycleType; id: string; startsAt: Date; endsAt: Date }[] = [];
  const events: AwardSeed[] = [];
  for (const [cycleType, id] of [
    ["weekly", TEST_WEEKLY_PERIOD_ID],
    ["monthly", TEST_MONTHLY_PERIOD_ID],
  ] as const) {
    const current = leaderboardPeriodWindow(cycleType, now);
    const previous = leaderboardPeriodWindow(
      cycleType,
      new Date(current.startsAt.getTime() - 1),
    );
    period(
      id,
      cycleType,
      previous.startsAt,
      previous.endsAt,
      "active",
      [],
      [{ rank: 1, coins: 75 }, { rank: 2, coins: 0 }, { rank: 3, coins: 10 }],
    );
    expired.push({
      cycleType,
      id,
      startsAt: previous.startsAt,
      endsAt: previous.endsAt,
    });
    const event: AwardSeed = {
      matchId: `75000000-0000-4000-8000-${cycleType === "weekly" ? "000000000001" : "000000000002"}`,
      startsAt: new Date(previous.startsAt.getTime() + 60_000),
      userId: TEST_PLAYER_ONE_ID,
      rank: 1,
      kills: 4,
      coins: cycleType === "weekly" ? 130 : 210,
    };
    events.push(event);
    addAward(event, expired.length);
  }

  await reconcileDaily007LeaderboardPeriods(now);

  for (const previous of expired) {
    const saved = daily007LeaderboardTestDb.periods.get(previous.id);
    assert.equal(saved?.status, "pending_approval");
    assert.deepEqual(
      (saved?.final_standings as StandingSeed[]).map((standing) => ({
        userId: standing.userId,
        points: standing.points,
      })),
      expectedStandings(events, previous.startsAt, previous.endsAt)
        .map(({ userId, points }) => ({ userId, points })),
    );
    assert.equal(saved?.approved_by, null);
    const next = [...daily007LeaderboardTestDb.periods.values()].find(
      (candidate) => candidate.previous_period_id === previous.id,
    );
    assert.equal(next?.status, "active");
  }
  assert.equal(daily007LeaderboardTestDb.users.get(TEST_PLAYER_ONE_ID)?.wallet_coins, 100);
  assert.equal(daily007LeaderboardTestDb.ledger.size, 0);
});

test("Full Admin approval pays only configured ranks once and rolls back a failed multi-player payout", async () => {
  daily007LeaderboardTestDb.reset();
  seedPendingAndOpenPeriods(new Date());
  const originalBalances = [
    TEST_PLAYER_ONE_ID,
    TEST_PLAYER_TWO_ID,
    TEST_PLAYER_THREE_ID,
    TEST_PLAYER_FOUR_ID,
  ].map((id) => daily007LeaderboardTestDb.users.get(id)?.wallet_coins);

  await withServer(async (origin) => {
    const pending = await call(
      origin,
      TEST_FULL_ADMIN_ID,
      "/daily007/v2/admin/leaderboards/approvals",
      "GET",
    );
    assert.equal(pending.status, 200);
    assert.deepEqual(
      pending.body.periods.map((item: { id: string }) => item.id).sort(),
      [TEST_MONTHLY_PERIOD_ID, TEST_WEEKLY_PERIOD_ID].sort(),
    );

    const tournamentAdminList = await call(
      origin,
      TEST_TOURNAMENT_ADMIN_ID,
      "/daily007/v2/admin/leaderboards/approvals",
      "GET",
    );
    assert.equal(tournamentAdminList.status, 403);
    const tournamentAdminApproval = await call(
      origin,
      TEST_TOURNAMENT_ADMIN_ID,
      `/daily007/v2/admin/leaderboards/periods/${TEST_WEEKLY_PERIOD_ID}/approve`,
      "POST",
    );
    assert.equal(tournamentAdminApproval.status, 403);
    assert.equal(daily007LeaderboardTestDb.ledger.size, 0);

    daily007LeaderboardTestDb.failWalletUpdateFor = TEST_PLAYER_TWO_ID;
    const failedApproval = await call(
      origin,
      TEST_FULL_ADMIN_ID,
      `/daily007/v2/admin/leaderboards/periods/${TEST_WEEKLY_PERIOD_ID}/approve`,
      "POST",
    );
    assert.equal(failedApproval.status, 503);
    assert.equal(
      daily007LeaderboardTestDb.periods.get(TEST_WEEKLY_PERIOD_ID)?.status,
      "pending_approval",
    );
    assert.equal(daily007LeaderboardTestDb.ledger.size, 0);
    assert.deepEqual(
      [
        TEST_PLAYER_ONE_ID,
        TEST_PLAYER_TWO_ID,
        TEST_PLAYER_THREE_ID,
        TEST_PLAYER_FOUR_ID,
      ].map((id) => daily007LeaderboardTestDb.users.get(id)?.wallet_coins),
      originalBalances,
    );

    daily007LeaderboardTestDb.failWalletUpdateFor = null;
    const weeklyApproval = await call(
      origin,
      TEST_FULL_ADMIN_ID,
      `/daily007/v2/admin/leaderboards/periods/${TEST_WEEKLY_PERIOD_ID}/approve`,
      "POST",
    );
    assert.equal(weeklyApproval.status, 200);
    assert.equal(weeklyApproval.body.alreadyApproved, false);
    assert.equal(weeklyApproval.body.approvedBy, TEST_FULL_ADMIN_ID);
    assert.deepEqual(
      weeklyApproval.body.payouts.map((payout: { rank: number; userId: string; coins: number; balanceAfter: number }) => ({
        rank: payout.rank,
        userId: payout.userId,
        coins: payout.coins,
        balanceAfter: payout.balanceAfter,
      })),
      [
        { rank: 1, userId: TEST_PLAYER_ONE_ID, coins: 50, balanceAfter: 150 },
        { rank: 2, userId: TEST_PLAYER_TWO_ID, coins: 40, balanceAfter: 140 },
      ],
    );
    assert.equal(daily007LeaderboardTestDb.users.get(TEST_PLAYER_THREE_ID)?.wallet_coins, 100);
    assert.equal(daily007LeaderboardTestDb.users.get(TEST_PLAYER_FOUR_ID)?.wallet_coins, 100);
    assert.equal(daily007LeaderboardTestDb.ledger.size, 2);
    assert.equal(
      daily007LeaderboardTestDb.ledger.get(`leaderboard-cycle:${TEST_WEEKLY_PERIOD_ID}:rank:1`)?.balance_after,
      150,
    );
    assert.equal(daily007LeaderboardTestDb.periods.get(TEST_WEEKLY_PERIOD_ID)?.status, "finalized");
    assert.equal(
      daily007LeaderboardTestDb.periods.get(TEST_WEEKLY_PERIOD_ID)?.approved_by,
      TEST_FULL_ADMIN_ID,
    );

    const repeatedApproval = await call(
      origin,
      TEST_FULL_ADMIN_ID,
      `/daily007/v2/admin/leaderboards/periods/${TEST_WEEKLY_PERIOD_ID}/approve`,
      "POST",
    );
    assert.equal(repeatedApproval.status, 200);
    assert.equal(repeatedApproval.body.alreadyApproved, true);
    assert.deepEqual(repeatedApproval.body.payouts, []);
    assert.equal(daily007LeaderboardTestDb.ledger.size, 2);
    assert.equal(daily007LeaderboardTestDb.users.get(TEST_PLAYER_ONE_ID)?.wallet_coins, 150);
    assert.equal(daily007LeaderboardTestDb.users.get(TEST_PLAYER_TWO_ID)?.wallet_coins, 140);

    const monthlyApproval = await call(
      origin,
      TEST_FULL_ADMIN_ID,
      `/daily007/v2/admin/leaderboards/periods/${TEST_MONTHLY_PERIOD_ID}/approve`,
      "POST",
    );
    assert.equal(monthlyApproval.status, 200);
    assert.deepEqual(
      monthlyApproval.body.payouts.map((payout: { rank: number; userId: string; coins: number; balanceAfter: number }) => ({
        rank: payout.rank,
        userId: payout.userId,
        coins: payout.coins,
        balanceAfter: payout.balanceAfter,
      })),
      [
        { rank: 1, userId: TEST_PLAYER_THREE_ID, coins: 25, balanceAfter: 125 },
        { rank: 3, userId: TEST_PLAYER_TWO_ID, coins: 5, balanceAfter: 145 },
      ],
    );
    assert.equal(daily007LeaderboardTestDb.users.get(TEST_PLAYER_FOUR_ID)?.wallet_coins, 100);
    assert.equal(daily007LeaderboardTestDb.ledger.size, 4);
  });
});