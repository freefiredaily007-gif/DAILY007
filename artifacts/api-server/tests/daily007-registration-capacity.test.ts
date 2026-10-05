import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import test from "node:test";
import daily007V2Router from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  FIRST_PLAYER_ID,
  registrationCapacityTestDb,
  SECOND_PLAYER_ID,
  TEST_MATCH_ID,
  TEST_SECOND_MATCH_ID,
} from "./support/daily007-registration-capacity-test-db";

const TEST_AUTH_SECRET = "last-tournament-slot-test-secret-32-characters";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

test.after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
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

type TeamRegistration = {
  teamName: string;
  teammates: { name: string; uid: string }[];
};

async function sendRegistration(
  origin: string,
  playerId: string,
  gameUid: string,
  team?: TeamRegistration,
  matchId = TEST_MATCH_ID,
) {
  const token = makeToken(playerId, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}/daily007/v2/matches/${matchId}/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      captainGameName: `Captain ${playerId.slice(-1)}`,
      captainGameUid: gameUid,
      ...(team ? { teamName: team.teamName } : {}),
      teammates: team?.teammates ?? [],
    }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

test("simultaneous joins cannot charge both players for the last tournament slot", async () => {
  registrationCapacityTestDb.reset();
  const lockHold = registrationCapacityTestDb.holdNextMatchRowLock();

  await withServer(async (origin) => {
    const firstRequest = sendRegistration(origin, FIRST_PLAYER_ID, "FF-FIRST-PLAYER");
    try {
      const firstLocked = await Promise.race([
        lockHold.firstAcquired.then(() => true),
        firstRequest.then(() => false),
      ]);
      assert.equal(firstLocked, true, "the first join should hold the match row lock");

      const secondRequest = sendRegistration(origin, SECOND_PLAYER_ID, "FF-SECOND-PLAYER");
      const secondQueued = await Promise.race([
        lockHold.secondQueued.then(() => true),
        Promise.all([firstRequest, secondRequest]).then(() => false),
      ]);
      assert.equal(secondQueued, true, "the other join should wait for the same match row");

      lockHold.release();
      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      assert.equal(first.status, 201);
      assert.equal(second.status, 409);
      assert.match(String(second.body.error), /full/i);
      assert.equal(second.body.code, "MATCH_FULL");
      assert.equal(first.body.registeredCount, registrationCapacityTestDb.match.capacity);
      assert.equal(first.body.isFull, true);
      assert.equal(first.body.matchStatus, "full");

      const approved = registrationCapacityTestDb.registrations.filter((registration) =>
        registration.match_id === TEST_MATCH_ID && registration.status === "approved",
      );
      assert.equal(approved.length, registrationCapacityTestDb.match.capacity);
      assert.equal(registrationCapacityTestDb.match.is_full, true);
      assert.equal(registrationCapacityTestDb.match.status, "full");
      assert.equal(registrationCapacityTestDb.users.get(FIRST_PLAYER_ID)?.wallet_coins, 93);
      assert.equal(registrationCapacityTestDb.users.get(SECOND_PLAYER_ID)?.wallet_coins, 100);
      assert.equal(registrationCapacityTestDb.ledger.filter((entry) => entry.user_id === FIRST_PLAYER_ID).length, 1);
      assert.equal(registrationCapacityTestDb.ledger.filter((entry) => entry.user_id === SECOND_PLAYER_ID).length, 0);
      assert.equal(registrationCapacityTestDb.ledger.length, 2);
      assert.equal(approved.filter((registration) => registration.captain_user_id === FIRST_PLAYER_ID).length, 1);
      assert.equal(approved.filter((registration) => registration.captain_user_id === SECOND_PLAYER_ID).length, 0);
    } finally {
      lockHold.release();
    }
  });
});

test("simultaneous joins to different tournaments serialize one player's wallet deductions", async () => {
  registrationCapacityTestDb.reset();
  const lockHold = registrationCapacityTestDb.holdNextWalletRowLock();

  await withServer(async (origin) => {
    const firstRequest = sendRegistration(origin, FIRST_PLAYER_ID, "FF-FIRST-PLAYER");
    try {
      const firstLocked = await Promise.race([
        lockHold.firstAcquired.then(() => true),
        firstRequest.then(() => false),
      ]);
      assert.equal(firstLocked, true, "the first join should hold the player's wallet row lock");

      const secondRequest = sendRegistration(
        origin,
        FIRST_PLAYER_ID,
        "FF-FIRST-PLAYER-SECOND-MATCH",
        undefined,
        TEST_SECOND_MATCH_ID,
      );
      const secondQueued = await Promise.race([
        lockHold.secondQueued.then(() => true),
        Promise.all([firstRequest, secondRequest]).then(() => false),
      ]);
      assert.equal(secondQueued, true, "the other tournament join should wait for the same wallet row");

      lockHold.release();
      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.equal(registrationCapacityTestDb.users.get(FIRST_PLAYER_ID)?.wallet_coins, 86);
      assert.deepEqual(
        [first.body.walletCoins, second.body.walletCoins].sort((left, right) => Number(left) - Number(right)),
        [86, 93],
        "the two responses should reflect sequential wallet balances",
      );

      const registrations = registrationCapacityTestDb.registrations.filter((registration) =>
        registration.captain_user_id === FIRST_PLAYER_ID,
      );
      assert.equal(registrations.length, 2);
      assert.deepEqual(
        new Set(registrations.map((registration) => registration.match_id)),
        new Set([TEST_MATCH_ID, TEST_SECOND_MATCH_ID]),
      );

      const ledgerEntries = registrationCapacityTestDb.ledger.filter((entry) =>
        entry.user_id === FIRST_PLAYER_ID,
      );
      assert.equal(ledgerEntries.length, 2);
      for (const matchId of [TEST_MATCH_ID, TEST_SECOND_MATCH_ID]) {
        const matchEntries = ledgerEntries.filter((entry) => entry.match_id === matchId);
        assert.equal(matchEntries.length, 1, `exactly one wallet ledger entry should exist for ${matchId}`);
        assert.equal(matchEntries[0].amount, -7);
        const registration = registrations.find((item) => item.match_id === matchId);
        assert.ok(registration);
        assert.equal(matchEntries[0].registration_id, registration.id);
      }
      assert.deepEqual(
        ledgerEntries.map((entry) => entry.balance_after).sort((left, right) => left - right),
        [86, 93],
        "ledger balances should reflect the serialized wallet updates",
      );
      assert.equal(
        Number(first.body.walletCoins),
        ledgerEntries.find((entry) => entry.match_id === TEST_MATCH_ID)?.balance_after,
      );
      assert.equal(
        Number(second.body.walletCoins),
        ledgerEntries.find((entry) => entry.match_id === TEST_SECOND_MATCH_ID)?.balance_after,
      );
    } finally {
      lockHold.release();
    }
  });
});

test("simultaneous joins cannot spend more than one affordable entry fee", async () => {
  registrationCapacityTestDb.reset();
  registrationCapacityTestDb.users.get(FIRST_PLAYER_ID)!.wallet_coins = 7;
  const rejectedMatchBefore = structuredClone(registrationCapacityTestDb.secondMatch);
  const lockHold = registrationCapacityTestDb.holdNextWalletRowLock();

  await withServer(async (origin) => {
    const firstRequest = sendRegistration(origin, FIRST_PLAYER_ID, "FF-FIRST-PLAYER");
    try {
      const firstLocked = await Promise.race([
        lockHold.firstAcquired.then(() => true),
        firstRequest.then(() => false),
      ]);
      assert.equal(firstLocked, true, "the first join should hold the player's wallet row");

      const secondRequest = sendRegistration(
        origin,
        FIRST_PLAYER_ID,
        "FF-FIRST-PLAYER-SECOND-MATCH",
        undefined,
        TEST_SECOND_MATCH_ID,
      );
      const secondQueued = await Promise.race([
        lockHold.secondQueued.then(() => true),
        Promise.all([firstRequest, secondRequest]).then(() => false),
      ]);
      assert.equal(secondQueued, true, "the other tournament join should wait for the same wallet row");

      lockHold.release();
      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      assert.equal(first.status, 201);
      assert.equal(second.status, 409);
      assert.equal(second.body.error, "Insufficient wallet balance: this entry costs 7 coins.");

      const endingBalance = registrationCapacityTestDb.users.get(FIRST_PLAYER_ID)?.wallet_coins;
      assert.equal(endingBalance, 0);
      assert.ok(endingBalance! >= 0, "the wallet balance must not become negative");
      assert.equal(Number(first.body.walletCoins), 0);

      const playerRegistrations = registrationCapacityTestDb.registrations.filter(
        (registration) => registration.captain_user_id === FIRST_PLAYER_ID,
      );
      assert.equal(playerRegistrations.length, 1);
      assert.equal(playerRegistrations[0].match_id, TEST_MATCH_ID);
      assert.equal(
        playerRegistrations.some((registration) => registration.match_id === TEST_SECOND_MATCH_ID),
        false,
        "the rejected tournament must not have a registration",
      );

      const playerLedgerEntries = registrationCapacityTestDb.ledger.filter(
        (entry) => entry.user_id === FIRST_PLAYER_ID,
      );
      assert.equal(playerLedgerEntries.length, 1);
      assert.equal(playerLedgerEntries[0].match_id, TEST_MATCH_ID);
      assert.equal(playerLedgerEntries[0].amount, -7);
      assert.equal(playerLedgerEntries[0].balance_after, 0);
      assert.equal(
        playerLedgerEntries.some((entry) => entry.match_id === TEST_SECOND_MATCH_ID),
        false,
        "the rejected tournament must not have a ledger entry",
      );
      assert.deepEqual(registrationCapacityTestDb.secondMatch, rejectedMatchBefore);
    } finally {
      lockHold.release();
    }
  });
});

test("simultaneous duo registrations cannot share the last tournament team slot", async () => {
  registrationCapacityTestDb.reset();
  registrationCapacityTestDb.match.mode = "squad";
  registrationCapacityTestDb.match.team_type = "duo";
  registrationCapacityTestDb.registrations[0].team_name = "Existing Duo";
  registrationCapacityTestDb.roster.push({
    registration_id: registrationCapacityTestDb.registrations[0].id,
    member_uid: "FF-EXISTING-002",
  });
  const lockHold = registrationCapacityTestDb.holdNextMatchRowLock();

  const firstTeammateUid = "FF-FIRST-TEAMMATE";
  const secondTeammateUid = "FF-SECOND-TEAMMATE";
  await withServer(async (origin) => {
    const firstRequest = sendRegistration(origin, FIRST_PLAYER_ID, "FF-FIRST-PLAYER", {
      teamName: "First Duo",
      teammates: [{ name: "First Teammate", uid: firstTeammateUid }],
    });
    try {
      const firstLocked = await Promise.race([
        lockHold.firstAcquired.then(() => true),
        firstRequest.then(() => false),
      ]);
      assert.equal(firstLocked, true, "the first team join should hold the match row lock");

      const secondRequest = sendRegistration(origin, SECOND_PLAYER_ID, "FF-SECOND-PLAYER", {
        teamName: "Second Duo",
        teammates: [{ name: "Second Teammate", uid: secondTeammateUid }],
      });
      const secondQueued = await Promise.race([
        lockHold.secondQueued.then(() => true),
        Promise.all([firstRequest, secondRequest]).then(() => false),
      ]);
      assert.equal(secondQueued, true, "the other team join should wait for the same match row");

      lockHold.release();
      const [first, second] = await Promise.all([firstRequest, secondRequest]);
      assert.equal(first.status, 201);
      assert.equal(second.status, 409);
      assert.match(String(second.body.error), /full/i);
      assert.equal(second.body.code, "MATCH_FULL");
      assert.equal(first.body.registeredCount, registrationCapacityTestDb.match.capacity);
      assert.equal(first.body.capacity, registrationCapacityTestDb.match.capacity);
      assert.equal(first.body.isFull, true);
      assert.equal(first.body.matchStatus, "full");

      const approved = registrationCapacityTestDb.registrations.filter((registration) =>
        registration.match_id === TEST_MATCH_ID && registration.status === "approved",
      );
      assert.equal(approved.length, registrationCapacityTestDb.match.capacity);
      assert.equal(registrationCapacityTestDb.match.is_full, true);
      assert.equal(registrationCapacityTestDb.match.status, "full");

      const firstRegistration = approved.find((registration) =>
        registration.captain_user_id === FIRST_PLAYER_ID,
      );
      assert.ok(firstRegistration, "the winning duo should have an approved registration");
      assert.equal(
        registrationCapacityTestDb.registrations.some((registration) =>
          registration.captain_user_id === SECOND_PLAYER_ID,
        ),
        false,
        "the losing duo should not have a registration",
      );
      assert.deepEqual(
        registrationCapacityTestDb.roster.filter((member) =>
          member.registration_id === firstRegistration.id,
        ).map((member) => member.member_uid),
        [firstTeammateUid],
        "the winning duo should retain its complete teammate roster",
      );
      assert.equal(
        registrationCapacityTestDb.roster.some((member) => member.member_uid === secondTeammateUid),
        false,
        "the losing duo should not leave a roster row behind",
      );

      assert.equal(registrationCapacityTestDb.users.get(FIRST_PLAYER_ID)?.wallet_coins, 93);
      assert.equal(registrationCapacityTestDb.users.get(SECOND_PLAYER_ID)?.wallet_coins, 100);
      assert.equal(registrationCapacityTestDb.ledger.filter((entry) => entry.user_id === FIRST_PLAYER_ID).length, 1);
      assert.equal(registrationCapacityTestDb.ledger.filter((entry) => entry.user_id === SECOND_PLAYER_ID).length, 0);
      assert.equal(registrationCapacityTestDb.ledger.length, 2);
    } finally {
      lockHold.release();
    }
  });
});