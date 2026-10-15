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
const CANCELLED_MATCH_ID = "70000000-0000-4000-8000-000000000009";
const CANCELLED_REGISTRATION_ID = "70000000-0000-4000-8000-000000000010";
const CANCELLED_AWARD_ID = "70000000-0000-4000-8000-000000000011";
const PROFILE_STATS_MATCH_TWO_ID = "70000000-0000-4000-8000-000000000012";
const PROFILE_STATS_MATCH_THREE_ID = "70000000-0000-4000-8000-000000000013";
const PROFILE_STATS_PENDING_MATCH_ID = "70000000-0000-4000-8000-000000000014";
const PROFILE_STATS_REGISTRATION_TWO_ID = "70000000-0000-4000-8000-000000000015";
const PROFILE_STATS_REGISTRATION_THREE_ID = "70000000-0000-4000-8000-000000000016";
const PROFILE_STATS_PENDING_REGISTRATION_ID = "70000000-0000-4000-8000-000000000017";
const PROFILE_STATS_AWARD_ONE_ID = "70000000-0000-4000-8000-000000000018";
const PROFILE_STATS_AWARD_TWO_ID = "70000000-0000-4000-8000-000000000019";
const PROFILE_STATS_AWARD_THREE_ID = "70000000-0000-4000-8000-000000000020";
const PROFILE_STATS_RUNNER_UP_AWARD_ID = "70000000-0000-4000-8000-000000000021";
const PROFILE_STATS_OTHER_PLAYER_MATCH_ID = "70000000-0000-4000-8000-000000000022";
const PROFILE_STATS_OTHER_PLAYER_REGISTRATION_ID = "70000000-0000-4000-8000-000000000023";
const PROFILE_STATS_OTHER_PLAYER_AWARD_ID = "70000000-0000-4000-8000-000000000024";
const PROFILE_STATS_DUPLICATE_REGISTRATION_ID = "70000000-0000-4000-8000-000000000025";
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
  method: "GET" | "POST" | "DELETE",
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

async function callPublic(origin: string, path: string): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`);
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

test("an Admin-created tournament appears in the enabled public list with its saved settings", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    const created = await call(origin, TEST_ADMIN_ID, "/tournaments", "POST", {
      name: "Public Clash Duo",
      mode: "Clash Squad",
      teamType: "Duo",
      entryCoins: 35,
      prizePool: 700,
      totalSlots: 2,
      rules: "Bring your own device.",
      banner: "cs",
      imageUrl: "https://example.invalid/public-clash-duo.png",
      date: "2031-06-17",
      time: "9:35 PM",
      prizeDist: "1st: 500 coins\n2nd: 200 coins",
    });
    assert.equal(created.status, 201);

    const publicList = await callPublic(origin, "/tournaments?enabled=true");
    assert.equal(publicList.status, 200);
    assert.ok(Array.isArray(publicList.body));
    const listed = publicList.body.find((tournament: any) => tournament.id === created.body.id);
    assert.ok(listed, "The public enabled tournament list should include the newly created tournament.");

    for (const field of [
      "name",
      "mode",
      "gameMode",
      "teamType",
      "date",
      "time",
      "startsAt",
      "entryCoins",
      "prizePool",
      "totalSlots",
      "rules",
      "banner",
      "imageUrl",
      "prizeDist",
      "enabled",
    ]) {
      assert.equal(listed[field], created.body[field], `The public list should preserve ${field}.`);
    }
  });
});

test("an Admin-closed tournament disappears from the enabled public list but remains in Admin history", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);

    const beforeClose = await callPublic(origin, "/tournaments?enabled=true");
    assert.equal(beforeClose.status, 200);
    assert.ok(
      beforeClose.body.some((tournament: any) => tournament.id === TEST_MATCH_ID),
      "The upcoming tournament should be in the enabled public list before Admin closes it.",
    );

    const closed = await call(
      origin,
      TEST_ADMIN_ID,
      `/tournaments/${TEST_MATCH_ID}`,
      "DELETE",
    );
    assert.equal(closed.status, 200);
    assert.equal(closed.body.data.enabled, false);
    assert.equal(closed.body.data.deleted, false);
    assert.equal(closed.body.data.closed, true);

    const enabledList = await callPublic(origin, "/tournaments?enabled=true");
    assert.equal(enabledList.status, 200);
    assert.ok(
      !enabledList.body.some((tournament: any) => tournament.id === TEST_MATCH_ID),
      "The closed tournament must not remain in the enabled public list.",
    );

    const adminList = await callPublic(origin, "/tournaments");
    const retained = adminList.body.find((tournament: any) => tournament.id === TEST_MATCH_ID);
    assert.ok(retained, "Admin history should retain a tournament that has registrations.");
    assert.equal(retained.enabled, false);
  });
});

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
    const recoverableResultsList = await call(
      origin,
      TEST_ADMIN_ID,
      "/admin/results?includeUnfinalized=true",
      "GET",
    );
    assert.equal(recoverableResultsList.status, 200);
    assert.deepEqual(
      recoverableResultsList.body.data.map((entry: any) => ({
        tournamentId: entry.tournamentId,
        registrationId: entry.registrationId,
        rank: entry.rank,
        prizeCoins: entry.prizeCoins,
      })),
      [{
        tournamentId: TEST_MATCH_ID,
        registrationId: TEST_RUNNER_UP_REGISTRATION_ID,
        rank: 2,
        prizeCoins: 600,
      }],
    );

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

    const standings = await callPublic(origin, `/tournaments/${TEST_MATCH_ID}/results`);
    assert.equal(standings.status, 200);
    assert.equal(standings.body.status, "finalized");
    assert.deepEqual(
      standings.body.entries.map((entry: any) => ({
        rank: entry.rank,
        kills: entry.kills,
        prizeCoins: entry.prizeCoins,
        gameName: entry.gameName,
        teamName: entry.teamName,
      })),
      [
        {
          rank: 1,
          kills: 7,
          prizeCoins: 1_500,
          gameName: "WinnerFF",
          teamName: null,
        },
        {
          rank: 2,
          kills: 3,
          prizeCoins: 600,
          gameName: "RunnerUpFF",
          teamName: null,
        },
      ],
    );

    const completedResultsList = await call(origin, TEST_ADMIN_ID, "/admin/results", "GET");
    assert.equal(completedResultsList.status, 200);
    assert.deepEqual(
      completedResultsList.body.data.map((entry: any) => ({
        playerName: entry.playerName,
        gameName: entry.gameName,
        teamName: entry.teamName,
        tournamentId: entry.tournamentId,
        rank: entry.rank,
        prizeCoins: entry.prizeCoins,
      })),
      [
        {
          playerName: "First Place",
          gameName: "WinnerFF",
          teamName: null,
          tournamentId: TEST_MATCH_ID,
          rank: 1,
          prizeCoins: 1_500,
        },
        {
          playerName: "Second Place",
          gameName: "RunnerUpFF",
          teamName: null,
          tournamentId: TEST_MATCH_ID,
          rank: 2,
          prizeCoins: 600,
        },
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

    const standingsAfterRetry = await call(
      origin,
      TEST_ADMIN_ID,
      `/tournaments/${TEST_MATCH_ID}/results`,
      "GET",
    );
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

test("public standings hide a rank-one award when cancellation commits between reads", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);
    tournamentResultsTestDb.match.starts_at = new Date(Date.now() - 60 * 60 * 1000);
    const winner = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_WINNER_REGISTRATION_ID,
      rank: 1,
      kills: 8,
      prizeCoins: 0,
    });
    assert.equal(winner.status, 201);

    const archivedWinnerAward = structuredClone(
      tournamentResultsTestDb.awards.find((award) =>
        award.match_id === TEST_MATCH_ID && award.rank === 1,
      ),
    );
    assert.ok(archivedWinnerAward, "the completed tournament should have an archived rank-one award");
    tournamentResultsTestDb.cancelMatchAfterNextPublicResultsStatusRead(TEST_MATCH_ID);

    const standings = await callPublic(
      origin,
      `/tournaments/${TEST_MATCH_ID}/results`,
    );

    assert.equal(tournamentResultsTestDb.match.status, "cancelled");
    assert.equal(standings.status, 200);
    assert.equal(standings.body.status, "draft");
    assert.equal(standings.body.finalizedAt, null);
    assert.deepEqual(standings.body.entries, []);
    assert.deepEqual(tournamentResultsTestDb.awards, [archivedWinnerAward]);
  });
});

test("published results exclude cancelled tournaments with existing awards", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);
    tournamentResultsTestDb.match.starts_at = new Date(Date.now() - 60 * 60 * 1000);

    const completedWinner = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_WINNER_REGISTRATION_ID,
      rank: 1,
      kills: 8,
      prizeCoins: 0,
    });
    assert.equal(completedWinner.status, 201);

    const cancelledMatch = structuredClone(tournamentResultsTestDb.match);
    cancelledMatch.id = CANCELLED_MATCH_ID;
    cancelledMatch.title = "Cancelled tournament with historical award";
    cancelledMatch.starts_at = new Date(Date.now() - 2 * 60 * 60 * 1000);
    cancelledMatch.status = "cancelled";
    cancelledMatch.enabled = false;
    tournamentResultsTestDb.additionalMatches.push(cancelledMatch);
    tournamentResultsTestDb.registrations.push({
      id: CANCELLED_REGISTRATION_ID,
      match_id: CANCELLED_MATCH_ID,
      captain_user_id: TEST_RUNNER_UP_ID,
      captain_name: "Cancelled Account",
      captain_game_name: "CancelledFF",
      team_name: null,
      status: "approved",
    });
    tournamentResultsTestDb.awards.push({
      id: CANCELLED_AWARD_ID,
      match_id: CANCELLED_MATCH_ID,
      registration_id: CANCELLED_REGISTRATION_ID,
      user_id: TEST_RUNNER_UP_ID,
      rank: 1,
      kills: 4,
      prize_coins: 500,
      created_at: new Date(Date.now() - 60 * 60 * 1000),
    });
    assert.ok(tournamentResultsTestDb.additionalMatches.some((match) =>
      match.id === CANCELLED_MATCH_ID && match.status === "cancelled",
    ));
    assert.ok(tournamentResultsTestDb.awards.some((award) =>
      award.match_id === CANCELLED_MATCH_ID && award.rank === 1,
    ));
    const archivedCancelledAward = structuredClone(
      tournamentResultsTestDb.awards.find((award) =>
        award.match_id === CANCELLED_MATCH_ID && award.rank === 1,
      ),
    );
    assert.ok(archivedCancelledAward);

    const completedStandings = await callPublic(
      origin,
      `/tournaments/${TEST_MATCH_ID}/results`,
    );
    assert.equal(completedStandings.status, 200);
    assert.equal(completedStandings.body.status, "finalized");
    assert.equal(completedStandings.body.entries.length, 1);
    assert.equal(completedStandings.body.entries[0].gameName, "WinnerFF");
    assert.equal(completedStandings.body.entries[0].prizeCoins, 1_500);

    const cancelledStandings = await callPublic(
      origin,
      `/tournaments/${CANCELLED_MATCH_ID}/results`,
    );
    assert.equal(cancelledStandings.status, 200);
    assert.equal(cancelledStandings.body.status, "draft");
    assert.equal(cancelledStandings.body.finalizedAt, null);
    assert.deepEqual(cancelledStandings.body.entries, []);
    assert.deepEqual(
      tournamentResultsTestDb.awards.find((award) =>
        award.match_id === CANCELLED_MATCH_ID && award.rank === 1,
      ),
      archivedCancelledAward,
    );

    const cancelledMyMatches = await call(
      origin,
      TEST_RUNNER_UP_ID,
      "/my/registrations",
      "GET",
    );
    assert.equal(cancelledMyMatches.status, 200);
    const cancelledRegistration = cancelledMyMatches.body.find(
      (entry: any) => entry.tournamentId === CANCELLED_MATCH_ID,
    );
    assert.ok(cancelledRegistration);
    assert.equal(cancelledRegistration.tournament.status, "cancelled");
    assert.deepEqual(cancelledRegistration.tournament.results, []);
    assert.equal(Object.hasOwn(cancelledRegistration, "result"), false);

    const winnerAccount = tournamentResultsTestDb.users.get(TEST_WINNER_ID);
    const runnerUpAccount = tournamentResultsTestDb.users.get(TEST_RUNNER_UP_ID);
    const winnerRegistration = tournamentResultsTestDb.registrations.find(
      (registration) => registration.id === TEST_WINNER_REGISTRATION_ID,
    );
    const runnerUpRegistration = tournamentResultsTestDb.registrations.find(
      (registration) => registration.id === TEST_RUNNER_UP_REGISTRATION_ID,
    );
    assert.ok(winnerAccount);
    assert.ok(runnerUpAccount);
    assert.ok(winnerRegistration);
    assert.ok(runnerUpRegistration);

    winnerAccount.wallet_coins = 987_654_321;
    runnerUpAccount.wallet_coins = 876_543_210;
    winnerAccount.phone = "private-winner-phone-731";
    winnerAccount.game_uid = "private-winner-uid-842";
    runnerUpAccount.phone = "private-runner-phone-953";
    runnerUpAccount.game_uid = "private-runner-uid-164";
    winnerRegistration.team_name = "Winner Team";
    runnerUpRegistration.team_name = "Runner-Up Team";

    const runnerUpAward = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_RUNNER_UP_REGISTRATION_ID,
      rank: 2,
      kills: 3,
      prizeCoins: 0,
    });
    assert.equal(runnerUpAward.status, 201);

    const privateAccountValues = [
      winnerAccount.name,
      winnerAccount.email,
      winnerAccount.phone,
      winnerAccount.game_uid,
      String(winnerAccount.wallet_coins),
      runnerUpAccount.name,
      runnerUpAccount.email,
      runnerUpAccount.phone,
      runnerUpAccount.game_uid,
      String(runnerUpAccount.wallet_coins),
    ];
    assert.ok(privateAccountValues.every((value) => value !== null));

    const standings = await callPublic(origin, `/tournaments/${TEST_MATCH_ID}/results`);
    assert.equal(standings.status, 200);
    assert.equal(standings.body.status, "finalized");
    assert.deepEqual(Object.keys(standings.body).sort(), [
      "entries",
      "finalizedAt",
      "status",
      "tournamentId",
    ]);
    assert.deepEqual(
      standings.body.entries,
      [
        {
          rank: 1,
          kills: 8,
          prizeCoins: 1_500,
          gameName: "WinnerFF",
          teamName: "Winner Team",
        },
        {
          rank: 2,
          kills: 3,
          prizeCoins: 600,
          gameName: "RunnerUpFF",
          teamName: "Runner-Up Team",
        },
      ],
    );

    const responseText = JSON.stringify(standings.body);
    for (const privateValue of privateAccountValues) {
      assert.equal(responseText.includes(String(privateValue)), false);
    }
  });
});

test("My Matches preserves an individual result when its tournament standings list is empty", async () => {
  tournamentResultsTestDb.reset();

  await withServer(async (origin) => {
    await createResultsTournament(origin);
    tournamentResultsTestDb.match.starts_at = new Date(Date.now() - 60 * 60 * 1000);

    const runnerUpAward = await call(origin, TEST_ADMIN_ID, "/admin/results", "POST", {
      tournamentId: TEST_MATCH_ID,
      registrationId: TEST_RUNNER_UP_REGISTRATION_ID,
      rank: 2,
      kills: 3,
      prizeCoins: 0,
    });
    assert.equal(runnerUpAward.status, 201);

    tournamentResultsTestDb.setMyRegistrationStandingsEmpty(TEST_MATCH_ID);
    const response = await call(origin, TEST_RUNNER_UP_ID, "/my/registrations", "GET");

    assert.equal(response.status, 200);
    const registration = response.body.find((entry: any) => entry.tournamentId === TEST_MATCH_ID);
    assert.ok(registration, "My Matches should return the player's registration.");
    assert.deepEqual(registration.tournament.results, [], "The test exercises an empty standings-list fallback.");
    assert.equal(registration.result, "Rank 2 · 3 kills · 600 coins", "The existing result string remains compatible.");
    assert.deepEqual(registration.resultDetails, {
      rank: 2,
      kills: 3,
      prizeCoins: 600,
      gameName: "RunnerUpFF",
      teamName: null,
    });
    assert.equal(Object.hasOwn(registration.resultDetails, "playerName"), false);
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
        rank: entry.rank,
        kills: entry.kills,
        prizeCoins: entry.prizeCoins,
      })),
      [{
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

test("authenticated profile totals match saved results across distinct approved matches", async () => {
  tournamentResultsTestDb.reset();
  tournamentResultsTestDb.match.status = "completed";
  tournamentResultsTestDb.match.enabled = false;

  for (const [index, matchId] of [
    PROFILE_STATS_MATCH_TWO_ID,
    PROFILE_STATS_MATCH_THREE_ID,
    PROFILE_STATS_PENDING_MATCH_ID,
    PROFILE_STATS_OTHER_PLAYER_MATCH_ID,
  ].entries()) {
    const match = structuredClone(tournamentResultsTestDb.match);
    match.id = matchId;
    match.title = `Profile stats match ${index + 2}`;
    match.starts_at = new Date(Date.UTC(2026, 0, index + 2));
    tournamentResultsTestDb.additionalMatches.push(match);
  }

  tournamentResultsTestDb.registrations = [
    {
      id: TEST_WINNER_REGISTRATION_ID,
      match_id: TEST_MATCH_ID,
      captain_user_id: TEST_WINNER_ID,
      captain_name: "First Place",
      captain_game_name: "WinnerFF",
      team_name: null,
      status: "approved",
    },
    {
      id: PROFILE_STATS_REGISTRATION_TWO_ID,
      match_id: PROFILE_STATS_MATCH_TWO_ID,
      captain_user_id: TEST_WINNER_ID,
      captain_name: "First Place",
      captain_game_name: "WinnerFF",
      team_name: null,
      status: "approved",
    },
    {
      id: PROFILE_STATS_DUPLICATE_REGISTRATION_ID,
      match_id: PROFILE_STATS_MATCH_TWO_ID,
      captain_user_id: TEST_WINNER_ID,
      captain_name: "First Place",
      captain_game_name: "WinnerFF",
      team_name: "Duplicate registration row",
      status: "approved",
    },
    {
      id: PROFILE_STATS_REGISTRATION_THREE_ID,
      match_id: PROFILE_STATS_MATCH_THREE_ID,
      captain_user_id: TEST_WINNER_ID,
      captain_name: "First Place",
      captain_game_name: "WinnerFF",
      team_name: null,
      status: "approved",
    },
    {
      id: PROFILE_STATS_PENDING_REGISTRATION_ID,
      match_id: PROFILE_STATS_PENDING_MATCH_ID,
      captain_user_id: TEST_WINNER_ID,
      captain_name: "First Place",
      captain_game_name: "WinnerFF",
      team_name: null,
      status: "pending",
    },
    {
      id: TEST_RUNNER_UP_REGISTRATION_ID,
      match_id: TEST_MATCH_ID,
      captain_user_id: TEST_RUNNER_UP_ID,
      captain_name: "Second Place",
      captain_game_name: "RunnerUpFF",
      team_name: null,
      status: "approved",
    },
    {
      id: PROFILE_STATS_OTHER_PLAYER_REGISTRATION_ID,
      match_id: PROFILE_STATS_OTHER_PLAYER_MATCH_ID,
      captain_user_id: TEST_RUNNER_UP_ID,
      captain_name: "Second Place",
      captain_game_name: "RunnerUpFF",
      team_name: null,
      status: "approved",
    },
  ];
  tournamentResultsTestDb.awards = [
    {
      id: PROFILE_STATS_AWARD_ONE_ID,
      match_id: TEST_MATCH_ID,
      registration_id: TEST_WINNER_REGISTRATION_ID,
      user_id: TEST_WINNER_ID,
      rank: 1,
      kills: 7,
      prize_coins: 1_500,
      created_at: new Date(Date.UTC(2026, 0, 1)),
    },
    {
      id: PROFILE_STATS_AWARD_TWO_ID,
      match_id: PROFILE_STATS_MATCH_TWO_ID,
      registration_id: PROFILE_STATS_REGISTRATION_TWO_ID,
      user_id: TEST_WINNER_ID,
      rank: 1,
      kills: 11,
      prize_coins: 2_500,
      created_at: new Date(Date.UTC(2026, 0, 2)),
    },
    {
      id: PROFILE_STATS_AWARD_THREE_ID,
      match_id: PROFILE_STATS_MATCH_THREE_ID,
      registration_id: PROFILE_STATS_REGISTRATION_THREE_ID,
      user_id: TEST_WINNER_ID,
      rank: 2,
      kills: 4,
      prize_coins: 350,
      created_at: new Date(Date.UTC(2026, 0, 3)),
    },
    {
      id: PROFILE_STATS_RUNNER_UP_AWARD_ID,
      match_id: TEST_MATCH_ID,
      registration_id: TEST_RUNNER_UP_REGISTRATION_ID,
      user_id: TEST_RUNNER_UP_ID,
      rank: 2,
      kills: 3,
      prize_coins: 600,
      created_at: new Date(Date.UTC(2026, 0, 1)),
    },
    {
      id: PROFILE_STATS_OTHER_PLAYER_AWARD_ID,
      match_id: PROFILE_STATS_OTHER_PLAYER_MATCH_ID,
      registration_id: PROFILE_STATS_OTHER_PLAYER_REGISTRATION_ID,
      user_id: TEST_RUNNER_UP_ID,
      rank: 1,
      kills: 19,
      prize_coins: 1_900,
      created_at: new Date(Date.UTC(2026, 0, 4)),
    },
  ];

  await withServer(async (origin) => {
    const response = await call(origin, TEST_WINNER_ID, "/me/stats", "GET");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      matches: 3,
      wins: 2,
      kills: 22,
      prizeCoins: 4_350,
    });
    assert.equal(response.body.prizeCoins, 4_350);
    assert.equal(Object.hasOwn(response.body, "prize_coins"), false);
  });
});
