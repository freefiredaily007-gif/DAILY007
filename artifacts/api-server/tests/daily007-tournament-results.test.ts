import assert from "node:assert/strict";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { configuredPrizeForRank } from "../../daily007/src/lib/tournamentPrizes";
import { makeToken } from "../src/lib/daily007-session-token";
import compatCoreRouter from "../src/routes/daily007-compat-core";
import compatExtraRouter from "../src/routes/daily007-compat-extra";
import {
  TEST_ADMIN_ID,
  TEST_MATCH_ID,
  TEST_PENDING_PLAYER_ID,
  TEST_PENDING_REGISTRATION_ID,
  TEST_RUNNER_UP_ID,
  TEST_RUNNER_UP_REGISTRATION_ID,
  TEST_WINNER_ID,
  TEST_WINNER_REGISTRATION_ID,
  tournamentResultsTestDb,
} from "./support/daily007-tournament-results-test-db";

const TEST_AUTH_SECRET = "tournament-results-tests-only-secret-value-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(compatCoreRouter);
  app.use(compatExtraRouter);
  app.use((
    _error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({ error: "Internal server error." });
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

async function call(
  origin: string,
  actorId: string,
  path: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<JsonResult> {
  const token = makeToken(actorId, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function createResultsTournament(origin: string): Promise<void> {
  const startsAt = new Date(Date.now() + 86_400_000);
  const createdTournament = await call(origin, TEST_ADMIN_ID, "/tournaments", "POST", {
    name: "Prize verification tournament",
    mode: "battle_royale",
    teamType: "solo",
    entryCoins: 0,
    prizePool: 2_100,
    rules: "Test-only prize verification.",
    banner: "br",
    date: startsAt.toISOString().slice(0, 10),
    time: startsAt.toISOString().slice(11, 16),
    prizeDist: "1st: 1,500 coins\n2nd: 600 coins",
  });
  assert.equal(createdTournament.status, 201);
  assert.equal(createdTournament.body.id, TEST_MATCH_ID);
  assert.equal(createdTournament.body.prizeDist, "1st: 1,500 coins\n2nd: 600 coins");
  tournamentResultsTestDb.approveTestRegistrations();
}

function captureSettlementState() {
  return {
    wallets: Array.from(
      tournamentResultsTestDb.users,
      ([id, user]) => ({ id, walletCoins: user.wallet_coins }),
    ),
    ledger: structuredClone(tournamentResultsTestDb.ledger),
    stats: structuredClone(tournamentResultsTestDb.stats),
    awards: structuredClone(tournamentResultsTestDb.awards),
    registrations: structuredClone(tournamentResultsTestDb.registrations),
    match: structuredClone(tournamentResultsTestDb.match),
  };
}

test("admin result prize display follows each saved rank amount", () => {
  const tournament = {
    prizePool: 2_100,
    prizeDist: "1st: 1,500 coins\n2nd: 600 coins",
  };

  assert.equal(configuredPrizeForRank(tournament, 1), 1_500);
  assert.equal(configuredPrizeForRank(tournament, 2), 600);
  assert.equal(configuredPrizeForRank(tournament, 3), 0);
  assert.equal(configuredPrizeForRank({ prizePool: 2_100, prizeDist: "" }, 1), 2_100);
});

test("saved-prize results reject duplicate retries and competing winners without extra side effects", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);
    tournamentResultsTestDb.match.starts_at = new Date(Date.now() - 60 * 60 * 1000);

    const runnerUp = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_RUNNER_UP_REGISTRATION_ID,
      rank: 2,
      kills: 3,
      prizeCoins: 999_999,
    });
    assert.equal(runnerUp.status, 201);
    assert.equal(runnerUp.body.prizeCoins, 600);
    assert.equal(runnerUp.body.walletCoins, 800);
    assert.equal(tournamentResultsTestDb.users.get(TEST_RUNNER_UP_ID)?.wallet_coins, 800);
    assert.equal(tournamentResultsTestDb.match.enabled, true);

    const incompleteStandings = await call(
      origin,
      TEST_ADMIN_ID,
      `/tournaments/${TEST_MATCH_ID}/results`,
      "GET",
    );
    assert.equal(incompleteStandings.status, 200);
    assert.equal(incompleteStandings.body.status, "draft");
    assert.equal(incompleteStandings.body.finalizedAt, null);
    assert.deepEqual(incompleteStandings.body.entries, []);
    const incompleteResultsList = await call(origin, TEST_ADMIN_ID, "/admin/results", "GET");
    assert.equal(incompleteResultsList.status, 200);
    assert.deepEqual(incompleteResultsList.body.data, []);

    const winner = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_WINNER_REGISTRATION_ID,
      rank: 1,
      kills: 7,
      prizeCoins: 0,
    });
    assert.equal(winner.status, 201);
    assert.equal(winner.body.prizeCoins, 1_500);
    assert.equal(winner.body.walletCoins, 1_600);
    assert.equal(tournamentResultsTestDb.users.get(TEST_WINNER_ID)?.wallet_coins, 1_600);
    assert.equal(tournamentResultsTestDb.match.enabled, false);

    assert.deepEqual(tournamentResultsTestDb.ledger, [
      { userId: TEST_RUNNER_UP_ID, amount: 600, balanceAfter: 800, reason: "match_prize" },
      { userId: TEST_WINNER_ID, amount: 1_500, balanceAfter: 1_600, reason: "match_prize" },
    ]);
    assert.deepEqual(tournamentResultsTestDb.stats.get(TEST_RUNNER_UP_ID), {
      matches: 1, wins: 0, kills: 3, prize_coins: 600,
    });
    assert.deepEqual(tournamentResultsTestDb.stats.get(TEST_WINNER_ID), {
      matches: 1, wins: 1, kills: 7, prize_coins: 1_500,
    });

    const standings = await call(origin, TEST_ADMIN_ID, `/tournaments/${TEST_MATCH_ID}/results`, "GET");
    assert.equal(standings.status, 200);
    assert.equal(standings.body.status, "finalized");
    assert.deepEqual(
      standings.body.entries.map((entry: any) => ({
        registrationId: entry.registrationId,
        rank: entry.rank,
        kills: entry.kills,
        prizeCoins: entry.prizeCoins,
        gameName: entry.gameName,
      })),
      [
        {
          registrationId: TEST_WINNER_REGISTRATION_ID,
          rank: 1,
          kills: 7,
          prizeCoins: 1_500,
          gameName: "WinnerFF",
        },
        {
          registrationId: TEST_RUNNER_UP_REGISTRATION_ID,
          rank: 2,
          kills: 3,
          prizeCoins: 600,
          gameName: "RunnerUpFF",
        },
      ],
    );

    const completedResultsList = await call(origin, TEST_ADMIN_ID, "/admin/results", "GET");
    assert.equal(completedResultsList.status, 200);
    assert.deepEqual(
      completedResultsList.body.data.map((entry: any) => ({
        tournamentId: entry.tournamentId,
        rank: entry.rank,
        prizeCoins: entry.prizeCoins,
      })),
      [
        { tournamentId: TEST_MATCH_ID, rank: 1, prizeCoins: 1_500 },
        { tournamentId: TEST_MATCH_ID, rank: 2, prizeCoins: 600 },
      ],
    );

    const sideEffectsBeforeRetry = captureSettlementState();

    const duplicateWinner = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_WINNER_REGISTRATION_ID,
      rank: 1,
      kills: 7,
      prizeCoins: 0,
    });
    assert.equal(duplicateWinner.status, 409);
    assert.equal(duplicateWinner.body.error, "A result has already been published for this registration.");

    const standingsAfterRetry = await call(origin, TEST_ADMIN_ID, `/tournaments/${TEST_MATCH_ID}/results`, "GET");
    assert.equal(standingsAfterRetry.status, 200);
    assert.deepEqual(standingsAfterRetry.body, standings.body);
    assert.deepEqual(captureSettlementState(), sideEffectsBeforeRetry);

    const competingWinner = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_RUNNER_UP_REGISTRATION_ID,
      rank: 1,
      kills: 9,
      prizeCoins: 999_999,
    });
    assert.equal(competingWinner.status, 409);
    assert.equal(competingWinner.body.error, "A winner has already been declared for this tournament.");

    const standingsAfterCompetition = await call(origin, TEST_ADMIN_ID, `/tournaments/${TEST_MATCH_ID}/results`, "GET");
    assert.equal(standingsAfterCompetition.status, 200);
    assert.deepEqual(standingsAfterCompetition.body, standings.body);
    assert.deepEqual(captureSettlementState(), sideEffectsBeforeRetry);
  });
});

test("failed result settlement rolls back every write and permits one valid retry", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);
    tournamentResultsTestDb.match.starts_at = new Date(Date.now() - 60 * 60 * 1000);

    const before = captureSettlementState();
    const standingsBefore = await call(
      origin,
      TEST_ADMIN_ID,
      `/tournaments/${TEST_MATCH_ID}/results`,
      "GET",
    );
    const resultsBefore = await call(origin, TEST_ADMIN_ID, "/admin/results", "GET");
    assert.equal(standingsBefore.status, 200);
    assert.equal(standingsBefore.body.status, "draft");
    assert.deepEqual(standingsBefore.body.entries, []);
    assert.equal(resultsBefore.status, 200);
    assert.deepEqual(resultsBefore.body.data, []);

    tournamentResultsTestDb.failOnNextMatchFinalization();
    const failed = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_WINNER_REGISTRATION_ID,
      rank: 1,
      kills: 7,
      prizeCoins: 0,
    });

    assert.equal(failed.status, 500);
    assert.deepEqual(tournamentResultsTestDb.finalizationFailureObservation, {
      awardCount: 1,
      ledgerCount: 1,
      stats: { matches: 1, wins: 1, kills: 7, prize_coins: 1_500 },
      walletCoins: 1_600,
      matchEnabled: true,
    }, "the injected failure must occur after all settlement writes but before match finalization");
    assert.deepEqual(captureSettlementState(), before);

    const standingsAfterFailure = await call(
      origin,
      TEST_ADMIN_ID,
      `/tournaments/${TEST_MATCH_ID}/results`,
      "GET",
    );
    const resultsAfterFailure = await call(origin, TEST_ADMIN_ID, "/admin/results", "GET");
    assert.equal(standingsAfterFailure.status, 200);
    assert.equal(resultsAfterFailure.status, 200);
    assert.deepEqual(standingsAfterFailure.body, standingsBefore.body);
    assert.deepEqual(resultsAfterFailure.body, resultsBefore.body);

    const retry = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_WINNER_REGISTRATION_ID,
      rank: 1,
      kills: 7,
      prizeCoins: 0,
    });
    assert.equal(retry.status, 201);
    assert.equal(retry.body.prizeCoins, 1_500);
    assert.equal(retry.body.walletCoins, 1_600);
    assert.equal(tournamentResultsTestDb.users.get(TEST_WINNER_ID)?.wallet_coins, 1_600);
    assert.equal(tournamentResultsTestDb.users.get(TEST_RUNNER_UP_ID)?.wallet_coins, 200);
    assert.equal(tournamentResultsTestDb.awards.length, 1);
    assert.equal(tournamentResultsTestDb.ledger.length, 1);
    assert.equal(tournamentResultsTestDb.stats.size, 1);
    assert.deepEqual(tournamentResultsTestDb.stats.get(TEST_WINNER_ID), {
      matches: 1,
      wins: 1,
      kills: 7,
      prize_coins: 1_500,
    });
    assert.deepEqual(tournamentResultsTestDb.ledger, [
      { userId: TEST_WINNER_ID, amount: 1_500, balanceAfter: 1_600, reason: "match_prize" },
    ]);
    assert.equal(tournamentResultsTestDb.match.enabled, false);

    const standingsAfterRetry = await call(
      origin,
      TEST_ADMIN_ID,
      `/tournaments/${TEST_MATCH_ID}/results`,
      "GET",
    );
    assert.equal(standingsAfterRetry.status, 200);
    assert.equal(standingsAfterRetry.body.status, "finalized");
    assert.deepEqual(
      standingsAfterRetry.body.entries.map((entry: any) => ({
        registrationId: entry.registrationId,
        rank: entry.rank,
        kills: entry.kills,
        prizeCoins: entry.prizeCoins,
      })),
      [{
        registrationId: TEST_WINNER_REGISTRATION_ID,
        rank: 1,
        kills: 7,
        prizeCoins: 1_500,
      }],
    );
  });
});

test("result publishing is rejected before tournament start without settlement changes", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);
    const before = captureSettlementState();

    const result = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_WINNER_REGISTRATION_ID,
      rank: 1,
      kills: 7,
      prizeCoins: 0,
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error, "Results can only be published after the tournament starts.");
    assert.deepEqual(captureSettlementState(), before);
    assert.equal(tournamentResultsTestDb.awards.length, 0);
    assert.equal(tournamentResultsTestDb.stats.size, 0);
    assert.equal(tournamentResultsTestDb.ledger.length, 0);
  });
});

test("result publishing is rejected for pending registrations without settlement changes", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);
    tournamentResultsTestDb.match.starts_at = new Date(Date.now() - 60 * 60 * 1000);
    tournamentResultsTestDb.addPendingTestRegistration();
    assert.equal(
      tournamentResultsTestDb.registrations.find((registration) => registration.id === TEST_PENDING_REGISTRATION_ID)?.status,
      "pending",
    );
    const before = captureSettlementState();

    const result = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_PENDING_REGISTRATION_ID,
      rank: 1,
      kills: 7,
      prizeCoins: 0,
    });

    assert.equal(result.status, 404);
    assert.equal(result.body.error, "Registration was not found for this tournament/match.");
    assert.deepEqual(captureSettlementState(), before);
    assert.equal(tournamentResultsTestDb.users.get(TEST_PENDING_PLAYER_ID)?.wallet_coins, 300);
    assert.equal(tournamentResultsTestDb.awards.length, 0);
    assert.equal(tournamentResultsTestDb.stats.size, 0);
    assert.equal(tournamentResultsTestDb.ledger.length, 0);
  });
});

test("result publishing is rejected for cancelled tournaments without settlement changes", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);
    tournamentResultsTestDb.match.starts_at = new Date(Date.now() - 60 * 60 * 1000);
    tournamentResultsTestDb.match.status = "cancelled";
    const before = captureSettlementState();

    const result = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_WINNER_REGISTRATION_ID,
      rank: 1,
      kills: 7,
      prizeCoins: 0,
    });

    assert.equal(result.status, 409);
    assert.equal(result.body.error, "Results cannot be published for a cancelled tournament.");
    assert.deepEqual(captureSettlementState(), before);
    assert.equal(tournamentResultsTestDb.awards.length, 0);
    assert.equal(tournamentResultsTestDb.stats.size, 0);
    assert.equal(tournamentResultsTestDb.ledger.length, 0);
  });
});