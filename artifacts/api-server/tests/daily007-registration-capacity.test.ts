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

async function sendRegistration(origin: string, playerId: string, gameUid: string) {
  const token = makeToken(playerId, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}/daily007/v2/matches/${TEST_MATCH_ID}/register`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      captainGameName: `Captain ${playerId.slice(-1)}`,
      captainGameUid: gameUid,
      teammates: [],
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