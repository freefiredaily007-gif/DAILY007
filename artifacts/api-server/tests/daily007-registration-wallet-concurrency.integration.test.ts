import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import express from "express";
import type { Server } from "node:http";
import { pool } from "@workspace/db";
import { makeToken } from "../src/lib/daily007-session-token";
import daily007V2Router from "../src/routes/daily007-v2";

const TEST_AUTH_SECRET = "daily007-registration-wallet-concurrency-test-secret";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;
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

type RegistrationResponse = {
  status: number;
  body: Record<string, unknown>;
};

type Teammate = { name: string; uid: string };

type WalletRaceFixture = {
  userId: string;
  matchIds: [string, string];
  gameUids: [string, string];
  teamType: "solo" | "duo" | "squad";
  teamNames: [string, string];
  teammates: [Teammate[], Teammate[]];
  entryCoins: [number, number];
  startingWalletCoins: number;
};

const STARTING_WALLET_COINS = 100;

after(async () => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
  await pool.end();
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use((
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(500).json({
      error: "Test server encountered an unexpected error.",
      detail: error instanceof Error ? error.message : String(error),
    });
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

function authHeaders(userId: string): Record<string, string> {
  const token = makeToken(userId, 0);
  assert.ok(token, "The test player must receive a Daily007 session token.");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function registerForMatch(
  origin: string,
  userId: string,
  matchId: string,
  gameUid: string,
  team: { teammates: Teammate[]; teamName: string } | null,
): Promise<RegistrationResponse> {
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/register`, {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      captainGameName: "Concurrent Test Player",
      captainGameUid: gameUid,
      ...(team
        ? { teamName: team.teamName, teammates: team.teammates }
        : { teammates: [] }),
    }),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function createFixture(
  teamType: "solo" | "duo" | "squad",
  options: { entryCoins?: [number, number]; startingWalletCoins?: number } = {},
): Promise<WalletRaceFixture> {
  const entryCoins: [number, number] = options.entryCoins ?? [7, 13];
  const startingWalletCoins = options.startingWalletCoins ?? STARTING_WALLET_COINS;
  const teammateCount = teamType === "squad" ? 3 : teamType === "duo" ? 1 : 0;
  const createTeammates = (tournamentIndex: number): Teammate[] =>
    Array.from({ length: teammateCount }, (_, teammateIndex) => ({
      name: `Wallet Race ${teamType} Tournament ${tournamentIndex + 1} Player ${teammateIndex + 2}`,
      uid: `ff-${randomUUID()}`,
    }));
  const fixture: WalletRaceFixture = {
    userId: randomUUID(),
    matchIds: [randomUUID(), randomUUID()],
    gameUids: [`ff-${randomUUID()}`, `ff-${randomUUID()}`],
    teamType,
    teamNames: [`Wallet race ${teamType} ${randomUUID()}`, `Wallet race ${teamType} ${randomUUID()}`],
    teammates: [createTeammates(0), createTeammates(1)],
    entryCoins,
    startingWalletCoins,
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO daily007_v2_users (id, name, email, password_salt, password_hash, wallet_coins)
       VALUES ($1, 'Wallet Race Player', $2, 'test-salt', 'test-hash', $3)`,
      [fixture.userId, `player-${fixture.userId}@example.test`, fixture.startingWalletCoins],
    );
    for (const [index, matchId] of fixture.matchIds.entries()) {
      const storageMode = teamType === "solo" ? "solo" : "squad";
      const capacity = teamType === "solo" ? 48 : teamType === "duo" ? 24 : 12;
      await client.query(
        `INSERT INTO daily007_v2_matches
           (id, title, mode, game_mode, team_type, capacity, entry_coins, starts_at, status)
         VALUES ($1, $2, $3, 'battle_royale', $4, $5, $6, now() + interval '1 day', 'open')`,
        [
          matchId,
          `Wallet race tournament ${index + 1}`,
          storageMode,
          teamType,
          capacity,
          fixture.entryCoins[index]!,
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

async function cleanupFixture(fixture: WalletRaceFixture): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM daily007_v2_wallet_ledger WHERE user_id = $1 OR match_id = ANY($2::uuid[])",
      [fixture.userId, fixture.matchIds],
    );
    await client.query(
      `DELETE FROM daily007_v2_roster
        WHERE registration_id IN (
          SELECT id FROM daily007_v2_registrations WHERE match_id = ANY($1::uuid[])
        )`,
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_result_awards WHERE match_id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_registrations WHERE match_id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query(
      "DELETE FROM daily007_v2_matches WHERE id = ANY($1::uuid[])",
      [fixture.matchIds],
    );
    await client.query("DELETE FROM daily007_v2_users WHERE id = $1", [fixture.userId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function backendPid(client: { query<T>(sql: string): Promise<{ rows: T[] }> }): Promise<number> {
  const result = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
  const pid = result.rows[0]?.pid;
  assert.ok(pid, "PostgreSQL must provide a backend id for the wallet lock holder.");
  return Number(pid);
}

async function waitForBlockedRequests(
  blockerPid: number,
  expectedCount: number,
  queryFragment: string,
  lockDescription: string,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ pid: number; blockers: number[] }>(
      `SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
         FROM pg_stat_activity activity
        WHERE activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
          AND activity.query ILIKE $1
        ORDER BY activity.query_start`,
      [`%${queryFragment}%`],
    );
    if (result.rows.length >= expectedCount) {
      assert.equal(result.rows.length, expectedCount, `Only the ${expectedCount} competing requests should be waiting.`);
      const requestPids = new Set(result.rows.map((row) => Number(row.pid)));
      assert.ok(
        result.rows.some((row) => row.blockers.map(Number).includes(blockerPid)),
        `At least one request must be waiting directly on the test ${lockDescription} lock.`,
      );
      assert.ok(
        result.rows.every((row) =>
          row.blockers.some((pid) => Number(pid) === blockerPid || requestPids.has(Number(pid))),
        ),
        `Each request must be queued behind the test ${lockDescription} lock or an earlier waiting request.`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expectedCount} requests to block on the ${lockDescription} row.`);
}

async function runConcurrentWalletRace(teamType: WalletRaceFixture["teamType"]): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture(teamType);
    fixtureForCleanup = fixture;
    const blocker = await pool.connect();
    blockerForCleanup = blocker;

    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [fixture.userId],
      );
      const blockerPid = await backendPid(blocker);

      submissions = fixture.matchIds.map((matchId, index) =>
        registerForMatch(
          origin,
          fixture.userId,
          matchId,
          fixture.gameUids[index],
          teamType !== "solo"
            ? {
                teammates: fixture.teammates[index],
                teamName: fixture.teamNames[index],
              }
            : null,
        ),
      );

      try {
        await waitForBlockedRequests(
          blockerPid,
          2,
          "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
          "wallet",
        );
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const responses = await Promise.all(submissions);
      assert.deepEqual(
        responses.map((response) => response.status),
        [201, 201],
        `unexpected registration responses: ${JSON.stringify(responses)}`,
      );
      assert.notEqual(fixture.entryCoins[0], fixture.entryCoins[1]);

      const registrations = await pool.query<{
        id: string;
        match_id: string;
        captain_user_id: string;
        captain_game_uid: string;
        team_name: string;
        entry_coins_paid: number;
        status: string;
        entry_coins: number;
      }>(
        `SELECT r.id, r.match_id, r.captain_user_id, r.captain_game_uid, r.team_name,
                r.entry_coins_paid, r.status, m.entry_coins
           FROM daily007_v2_registrations r
           JOIN daily007_v2_matches m ON m.id = r.match_id
          WHERE r.match_id = ANY($1::uuid[]) AND r.captain_user_id = $2
          ORDER BY r.match_id`,
        [fixture.matchIds, fixture.userId],
      );
      assert.equal(registrations.rows.length, 2, "both tournament entries must be stored");
      assert.deepEqual(
        new Set(registrations.rows.map((registration) => registration.match_id)),
        new Set(fixture.matchIds),
      );
      for (const [index, matchId] of fixture.matchIds.entries()) {
        const registration = registrations.rows.find((entry) => entry.match_id === matchId);
        assert.ok(registration, `registration for ${matchId} must exist`);
        assert.equal(registration.captain_user_id, fixture.userId);
        assert.equal(registration.captain_game_uid, fixture.gameUids[index]);
        assert.equal(
          registration.team_name,
          teamType === "solo" ? "" : fixture.teamNames[index],
        );
        assert.equal(registration.entry_coins, fixture.entryCoins[index]);
        assert.equal(registration.entry_coins_paid, fixture.entryCoins[index]);
        assert.equal(registration.status, "approved");
        assert.equal(Number(responses[index].body.entryCoinsPaid), fixture.entryCoins[index]);
        assert.equal(responses[index].body.registrationId, registration.id);
      }

      const roster = await pool.query<{
        registration_id: string;
        match_id: string;
        position: number;
        member_uid: string | null;
        member_name: string;
      }>(
        `SELECT roster.registration_id, registration.match_id, roster.position,
                roster.member_uid, roster.member_name
           FROM daily007_v2_roster roster
           JOIN daily007_v2_registrations registration ON registration.id = roster.registration_id
          WHERE registration.match_id = ANY($1::uuid[]) AND registration.captain_user_id = $2
          ORDER BY registration.match_id, roster.position`,
        [fixture.matchIds, fixture.userId],
      );
      assert.equal(
        roster.rows.length,
        teamType === "solo" ? 0 : teamType === "duo" ? 2 : 6,
        teamType === "solo"
          ? "solo registrations must not create teammate rows"
          : teamType === "duo"
            ? "each duo registration must have exactly one teammate row"
            : "each squad registration must have exactly three teammate rows",
      );
      if (teamType !== "solo") {
        const allPlayerUids = [
          ...fixture.gameUids,
          ...fixture.teammates.flatMap((team) => team.map((teammate) => teammate.uid)),
        ];
        assert.equal(
          new Set(allPlayerUids).size,
          allPlayerUids.length,
          "every player across both tournament entries must have a unique game UID",
        );
        for (const [index, matchId] of fixture.matchIds.entries()) {
          const registration = registrations.rows.find((entry) => entry.match_id === matchId);
          assert.ok(registration, `registration for ${matchId} must exist`);
          const teammateRows = roster.rows.filter((row) => row.registration_id === registration.id);
          const expectedTeammates = fixture.teammates[index];
          assert.equal(
            teammateRows.length,
            teamType === "squad" ? 3 : 1,
            `registration for ${matchId} must own only its submitted teammates`,
          );
          assert.deepEqual(
            teammateRows.map(({ position, member_uid, member_name }) => ({
              position,
              member_uid,
              member_name,
            })),
            expectedTeammates.map((teammate, teammateIndex) => ({
              position: teammateIndex + 1,
              member_uid: teammate.uid,
              member_name: teammate.name,
            })),
            `registration for ${matchId} must retain its own teammates at their submitted positions`,
          );
          assert.ok(
            teammateRows.every((row) => row.match_id === matchId && row.registration_id === registration.id),
            `every teammate row for ${matchId} must remain attached to its own tournament registration`,
          );
        }
      }

      const expectedFinalBalance = fixture.startingWalletCoins -
        fixture.entryCoins.reduce((total, entryCoins) => total + entryCoins, 0);
      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      assert.deepEqual(
        wallet.rows,
        [{ wallet_coins: expectedFinalBalance }],
        "the player should pay exactly the two tournament-specific entry fees",
      );

      const ledger = await pool.query<{
        match_id: string;
        registration_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1 AND match_id = ANY($2::uuid[])
          ORDER BY balance_after DESC`,
        [fixture.userId, fixture.matchIds],
      );
      assert.equal(ledger.rows.length, 2, "there must be one wallet ledger entry per tournament");
      assert.deepEqual(
        new Set(ledger.rows.map((entry) => entry.match_id)),
        new Set(fixture.matchIds),
      );
      for (const entry of ledger.rows) {
        const matchIndex = fixture.matchIds.indexOf(entry.match_id);
        assert.ok(matchIndex >= 0, "each ledger entry must belong to one of the two tournaments");
        assert.equal(entry.amount, -fixture.entryCoins[matchIndex]);
        assert.equal(entry.reason, "match_entry");
        const registration = registrations.rows.find((row) => row.match_id === entry.match_id);
        assert.ok(registration);
        assert.equal(entry.registration_id, registration.id);
        assert.equal(entry.amount, -registration.entry_coins);
        assert.equal(entry.balance_after, Number(responses[matchIndex].body.walletCoins));
      }

      const [firstDebit, secondDebit] = [...ledger.rows]
        .sort((left, right) => right.balance_after - left.balance_after);
      assert.ok(firstDebit && secondDebit, "both serialized wallet debits must have ledger entries");
      assert.equal(
        firstDebit.balance_after - firstDebit.amount,
        fixture.startingWalletCoins,
        "the first ledger balance must start from the original wallet balance",
      );
      assert.equal(
        secondDebit.balance_after - secondDebit.amount,
        firstDebit.balance_after,
        "the second ledger balance must start from the first debit's balance",
      );
      assert.equal(
        secondDebit.balance_after,
        expectedFinalBalance,
        "the last ledger balance must match the final wallet balance",
      );
    });
  } finally {
    try {
      if (blockerForCleanup && blockerTransactionOpen) {
        await blockerForCleanup.query("ROLLBACK");
        blockerTransactionOpen = false;
      }
    } finally {
      blockerForCleanup?.release();
      await Promise.allSettled(submissions);
      if (fixtureForCleanup) await cleanupFixture(fixtureForCleanup);
    }
  }
}

async function runConcurrentInsufficientBalanceRace(firstMatchIndex: 0 | 1): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  const submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture("solo", {
      entryCoins: [13, 17],
      startingWalletCoins: 20,
    });
    fixtureForCleanup = fixture;
    const secondMatchIndex = (1 - firstMatchIndex) as 0 | 1;
    const blocker = await pool.connect();
    blockerForCleanup = blocker;

    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query(
        "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        [fixture.userId],
      );
      const blockerPid = await backendPid(blocker);

      const submit = (matchIndex: 0 | 1) =>
        registerForMatch(
          origin,
          fixture.userId,
          fixture.matchIds[matchIndex],
          fixture.gameUids[matchIndex],
          null,
        );
      submissions.push(submit(firstMatchIndex));
      await waitForBlockedRequests(
        blockerPid,
        1,
        "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
        "wallet",
      );
      submissions.push(submit(secondMatchIndex));

      try {
        await waitForBlockedRequests(
          blockerPid,
          2,
          "SELECT wallet_coins, status FROM daily007_v2_users WHERE id = $1 FOR UPDATE",
          "wallet",
        );
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const [firstResponse, secondResponse] = await Promise.all(submissions);
      assert.equal(firstResponse.status, 201, JSON.stringify(firstResponse.body));
      assert.equal(firstResponse.body.entryCoinsPaid, fixture.entryCoins[firstMatchIndex]);
      assert.equal(
        firstResponse.body.walletCoins,
        fixture.startingWalletCoins - fixture.entryCoins[firstMatchIndex],
      );
      assert.equal(secondResponse.status, 409, JSON.stringify(secondResponse.body));
      assert.equal(secondResponse.body.code, "INSUFFICIENT_BALANCE");
      assert.equal(
        secondResponse.body.error,
        `Insufficient wallet balance: this entry costs ${fixture.entryCoins[secondMatchIndex]} coins.`,
      );

      const registrations = await pool.query<{
        id: string;
        match_id: string;
        entry_coins_paid: number;
        status: string;
      }>(
        `SELECT id, match_id, entry_coins_paid, status
           FROM daily007_v2_registrations
          WHERE match_id = ANY($1::uuid[]) AND captain_user_id = $2`,
        [fixture.matchIds, fixture.userId],
      );
      assert.equal(registrations.rows.length, 1, "only the successful tournament may have a registration");
      const registration = registrations.rows[0];
      assert.ok(registration);
      assert.equal(registration.match_id, fixture.matchIds[firstMatchIndex]);
      assert.equal(registration.entry_coins_paid, fixture.entryCoins[firstMatchIndex]);
      assert.equal(registration.status, "approved");
      assert.equal(firstResponse.body.registrationId, registration.id);
      assert.ok(
        !registrations.rows.some((row) => row.match_id === fixture.matchIds[secondMatchIndex]),
        "the rejected tournament must not retain a registration",
      );

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      const finalBalance = fixture.startingWalletCoins - fixture.entryCoins[firstMatchIndex];
      assert.deepEqual(wallet.rows, [{ wallet_coins: finalBalance }]);

      const ledger = await pool.query<{
        match_id: string;
        registration_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1 AND match_id = ANY($2::uuid[])`,
        [fixture.userId, fixture.matchIds],
      );
      assert.deepEqual(ledger.rows, [{
        match_id: fixture.matchIds[firstMatchIndex],
        registration_id: registration.id,
        amount: -fixture.entryCoins[firstMatchIndex],
        balance_after: finalBalance,
        reason: "match_entry",
      }], "exactly one debit must match the successful registration and final wallet balance");
      assert.ok(
        ledger.rows.every((entry) => entry.match_id !== fixture.matchIds[secondMatchIndex]),
        "the rejected tournament must not retain a debit",
      );
    });
  } finally {
    try {
      if (blockerForCleanup && blockerTransactionOpen) {
        await blockerForCleanup.query("ROLLBACK");
        blockerTransactionOpen = false;
      }
    } finally {
      blockerForCleanup?.release();
      await Promise.allSettled(submissions);
      if (fixtureForCleanup) await cleanupFixture(fixtureForCleanup);
    }
  }
}

async function runConcurrentDuoRetryRace(): Promise<void> {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let blockerForCleanup: Awaited<ReturnType<typeof pool.connect>> | undefined;
  let blockerTransactionOpen = false;
  let submissions: Promise<RegistrationResponse>[] = [];

  try {
    const fixture = await createFixture("duo");
    fixtureForCleanup = fixture;
    const matchId = fixture.matchIds[0];
    const entryCoins = fixture.entryCoins[0];
    const blocker = await pool.connect();
    blockerForCleanup = blocker;

    await withServer(async (origin) => {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      await blocker.query("SELECT id FROM daily007_v2_matches WHERE id = $1 FOR UPDATE", [matchId]);
      const blockerPid = await backendPid(blocker);

      const retryTeammates = [
        fixture.teammates[0][0]!,
        fixture.teammates[1][0]!,
      ];
      submissions = retryTeammates.map((teammate, index) =>
        registerForMatch(
          origin,
          fixture.userId,
          matchId,
          fixture.gameUids[0],
          {
            teamName: fixture.teamNames[index],
            teammates: [teammate],
          },
        ),
      );

      try {
        await waitForBlockedRequests(
          blockerPid,
          2,
          "FROM daily007_v2_matches WHERE id = $1 FOR UPDATE",
          "match",
        );
        await blocker.query("COMMIT");
        blockerTransactionOpen = false;
      } finally {
        if (blockerTransactionOpen) {
          await blocker.query("ROLLBACK");
          blockerTransactionOpen = false;
        }
      }

      const responses = await Promise.all(submissions);
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [200, 201],
        `one retry must create the registration and the other must reuse it: ${JSON.stringify(responses)}`,
      );
      const winnerIndex = responses.findIndex((response) => response.body.alreadyRegistered === false);
      const retryIndex = responses.findIndex((response) => response.body.alreadyRegistered === true);
      assert.notEqual(winnerIndex, -1, "one response must identify the newly created registration");
      assert.notEqual(retryIndex, -1, "one response must identify the existing registration");
      assert.equal(responses[winnerIndex].status, 201);
      assert.equal(responses[retryIndex].status, 200);
      assert.notEqual(fixture.teamNames[0], fixture.teamNames[1]);
      assert.notEqual(retryTeammates[0].uid, retryTeammates[1].uid);

      const registrations = await pool.query<{
        id: string;
        team_name: string;
        entry_coins_paid: number;
        status: string;
      }>(
        `SELECT id, team_name, entry_coins_paid, status
           FROM daily007_v2_registrations
          WHERE match_id = $1 AND captain_user_id = $2`,
        [matchId, fixture.userId],
      );
      assert.equal(registrations.rows.length, 1, "a retry must not create a second registration");
      const registration = registrations.rows[0];
      assert.ok(registration);
      assert.equal(registration.team_name, fixture.teamNames[winnerIndex]);
      assert.equal(registration.entry_coins_paid, entryCoins);
      assert.equal(registration.status, "approved");
      assert.equal(responses[winnerIndex].body.registrationId, registration.id);
      assert.equal(responses[retryIndex].body.registrationId, registration.id);
      for (const response of responses) {
        assert.equal(response.body.entryCoinsPaid, entryCoins);
        assert.equal(response.body.walletCoins, fixture.startingWalletCoins - entryCoins);
      }

      const roster = await pool.query<{
        registration_id: string;
        position: number;
        member_uid: string | null;
        member_name: string;
      }>(
        `SELECT registration_id, position, member_uid, member_name
           FROM daily007_v2_roster
          WHERE registration_id = $1
          ORDER BY position`,
        [registration.id],
      );
      assert.deepEqual(
        roster.rows,
        [{
          registration_id: registration.id,
          position: 1,
          member_uid: retryTeammates[winnerIndex]!.uid,
          member_name: retryTeammates[winnerIndex]!.name,
        }],
        "the registration must retain only the teammate payload from the winning request",
      );

      const wallet = await pool.query<{ wallet_coins: number }>(
        "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
        [fixture.userId],
      );
      assert.deepEqual(
        wallet.rows,
        [{ wallet_coins: fixture.startingWalletCoins - entryCoins }],
        "a retried signup must debit the entry fee only once",
      );

      const ledger = await pool.query<{
        match_id: string;
        registration_id: string;
        amount: number;
        balance_after: number;
        reason: string;
      }>(
        `SELECT match_id, registration_id, amount, balance_after, reason
           FROM daily007_v2_wallet_ledger
          WHERE user_id = $1 AND match_id = $2`,
        [fixture.userId, matchId],
      );
      assert.deepEqual(
        ledger.rows,
        [{
          match_id: matchId,
          registration_id: registration.id,
          amount: -entryCoins,
          balance_after: fixture.startingWalletCoins - entryCoins,
          reason: "match_entry",
        }],
        "there must be exactly one fee debit linked to the winning registration",
      );
    });
  } finally {
    try {
      if (blockerForCleanup && blockerTransactionOpen) {
        await blockerForCleanup.query("ROLLBACK");
        blockerTransactionOpen = false;
      }
    } finally {
      blockerForCleanup?.release();
      await Promise.allSettled(submissions);
      if (fixtureForCleanup) await cleanupFixture(fixtureForCleanup);
    }
  }
}

async function readEntryPaymentState(fixture: WalletRaceFixture, matchId: string) {
  const [wallet, registrations, roster, ledger] = await Promise.all([
    pool.query<{ wallet_coins: number }>(
      "SELECT wallet_coins FROM daily007_v2_users WHERE id = $1",
      [fixture.userId],
    ),
    pool.query<{ id: string; entry_coins_paid: number; status: string }>(
      `SELECT id, entry_coins_paid, status
         FROM daily007_v2_registrations
        WHERE match_id = $1 AND captain_user_id = $2`,
      [matchId, fixture.userId],
    ),
    pool.query<{
      registration_id: string;
      position: number;
      member_uid: string | null;
      member_name: string;
    }>(
      `SELECT roster.registration_id, roster.position, roster.member_uid, roster.member_name
         FROM daily007_v2_roster AS roster
         JOIN daily007_v2_registrations AS registration ON registration.id = roster.registration_id
        WHERE registration.match_id = $1 AND registration.captain_user_id = $2
        ORDER BY roster.position`,
      [matchId, fixture.userId],
    ),
    pool.query<{
      registration_id: string;
      amount: number;
      balance_after: number;
      reason: string;
    }>(
      `SELECT registration_id, amount, balance_after, reason
         FROM daily007_v2_wallet_ledger
        WHERE user_id = $1 AND match_id = $2`,
      [fixture.userId, matchId],
    ),
  ]);
  return {
    wallet: wallet.rows,
    registrations: registrations.rows,
    roster: roster.rows,
    ledger: ledger.rows,
  };
}

test("a failed entry-fee ledger insert rolls back the wallet, registration, and roster", async () => {
  let fixtureForCleanup: WalletRaceFixture | undefined;
  let failureConstraint: string | undefined;
  let failureConstraintInstalled = false;

  try {
    const fixture = await createFixture("duo", {
      entryCoins: [13, 17],
      startingWalletCoins: 50,
    });
    fixtureForCleanup = fixture;
    const matchId = fixture.matchIds[0];
    const before = await readEntryPaymentState(fixture, matchId);
    assert.deepEqual(before, {
      wallet: [{ wallet_coins: fixture.startingWalletCoins }],
      registrations: [],
      roster: [],
      ledger: [],
    });

    const constraintName = `daily007_test_reject_entry_${matchId.replace(/-/g, "")}`;
    failureConstraint = constraintName;
    await pool.query(
      `ALTER TABLE daily007_v2_wallet_ledger
         ADD CONSTRAINT "${constraintName}"
         CHECK (NOT (
           user_id = '${fixture.userId}'::uuid
           AND match_id = '${matchId}'::uuid
           AND reason = 'match_entry'
         ))`,
    );
    failureConstraintInstalled = true;

    await withServer(async (origin) => {
      const response = await registerForMatch(
        origin,
        fixture.userId,
        matchId,
        fixture.gameUids[0],
        {
          teamName: fixture.teamNames[0],
          teammates: fixture.teammates[0],
        },
      );
      assert.equal(response.status, 500, JSON.stringify(response.body));
      assert.ok(
        typeof response.body.detail === "string" &&
          response.body.detail.includes(constraintName),
        "the scoped ledger failure constraint must reject the entry-fee history insert",
      );
    });

    const after = await readEntryPaymentState(fixture, matchId);
    assert.deepEqual(after, before, "every entry side effect must be rolled back when ledger history fails");
  } finally {
    try {
      if (failureConstraintInstalled && failureConstraint) {
        await pool.query(
          `ALTER TABLE daily007_v2_wallet_ledger DROP CONSTRAINT IF EXISTS "${failureConstraint}"`,
        );
      }
    } finally {
      if (fixtureForCleanup) await cleanupFixture(fixtureForCleanup);
    }
  }
});

test("concurrent solo joins charge each tournament's own fee", () => runConcurrentWalletRace("solo"));

test("concurrent duo joins keep fees and teammate rosters matched to each tournament", () =>
  runConcurrentWalletRace("duo"));

test("concurrent squad joins keep every player, position, and fee matched to its tournament", () =>
  runConcurrentWalletRace("squad"));

test("a 20-coin wallet accepts only the first 13- or 17-coin join in either lock order", async () => {
  await runConcurrentInsufficientBalanceRace(0);
  await runConcurrentInsufficientBalanceRace(1);
});

test("concurrent duo retries keep one registration, fee debit, and winning teammate roster", () =>
  runConcurrentDuoRetryRace());
