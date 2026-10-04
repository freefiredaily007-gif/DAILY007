import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import test from "node:test";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  registrationProfileTestDb,
  TEST_MATCH_ID,
  TEST_PLAYER_ID,
} from "./support/daily007-registration-profile-name-test-db";

const TEST_AUTH_SECRET = "captain-profile-name-registration-test-secret";
const PROFILE_NAME = "Daily007 Profile Name";
const CAPTAIN_GAME_NAME = "FireCaptain";
const CAPTAIN_GAME_UID = "FF-CAPTAIN-017";
const TEAM_NAME = "Blue Fire";
const TEAMMATE_NAME = "FireMate";
const TEAMMATE_UID = "FF-MATE-029";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

test.after(() => {
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type RegistrationRequest = {
  label: string;
  path: string;
  body: Record<string, unknown>;
};

const registrationRequests: RegistrationRequest[] = [
  {
    label: "v2",
    path: `/daily007/v2/matches/${TEST_MATCH_ID}/register`,
    body: {
      captainName: "Forged Client Name",
      captainGameName: CAPTAIN_GAME_NAME,
      captainGameUid: CAPTAIN_GAME_UID,
      teamName: TEAM_NAME,
      teammates: [{ name: TEAMMATE_NAME, uid: TEAMMATE_UID }],
    },
  },
  {
    label: "legacy",
    path: `/tournaments/${TEST_MATCH_ID}/join`,
    body: {
      playerName: "Forged Legacy Name",
      captainGameName: CAPTAIN_GAME_NAME,
      gameUid: CAPTAIN_GAME_UID,
      teamName: TEAM_NAME,
      teamMembers: JSON.stringify([
        { name: CAPTAIN_GAME_NAME, uid: CAPTAIN_GAME_UID },
        { name: TEAMMATE_NAME, uid: TEAMMATE_UID },
      ]),
    },
  },
];

async function withServer(run: (origin: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(daily007V2Router);
  app.use(daily007CompatCoreRouter);
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

async function sendRegistration(
  origin: string,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = makeToken(TEST_PLAYER_ID, 0);
  assert.ok(token, "test account should receive a Daily007 session token");
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

for (const request of registrationRequests) {
  test(`${request.label} registration persists the authenticated profile name separately from Free Fire fields`, async () => {
    registrationProfileTestDb.reset(` ${PROFILE_NAME} `);
    try {
      await withServer(async (origin) => {
        const response = await sendRegistration(origin, request.path, request.body);
        assert.equal(response.status, 201);
        assert.equal(registrationProfileTestDb.registrations.length, 1);
        const registration = registrationProfileTestDb.registrations[0];
        assert.deepEqual(
          {
            captain_name: registration.captain_name,
            captain_game_name: registration.captain_game_name,
            captain_game_uid: registration.captain_game_uid,
            team_name: registration.team_name,
          },
          {
            captain_name: PROFILE_NAME,
            captain_game_name: CAPTAIN_GAME_NAME,
            captain_game_uid: CAPTAIN_GAME_UID,
            team_name: TEAM_NAME,
          },
        );
        assert.deepEqual(registrationProfileTestDb.roster, [{
          registration_id: registration.id,
          position: 1,
          member_uid: TEAMMATE_UID,
          member_name: TEAMMATE_NAME,
        }]);
        assert.equal(registrationProfileTestDb.user.wallet_coins, 93);
        assert.equal(registrationProfileTestDb.ledger.length, 1);
        assert.equal(registrationProfileTestDb.connectCount, 1);
      });
    } finally {
      registrationProfileTestDb.reset();
    }
  });
}

test("v2 and legacy registration reject an empty profile name before charging the wallet", async () => {
  try {
    for (const request of registrationRequests) {
      registrationProfileTestDb.reset("   ");
      await withServer(async (origin) => {
        const response = await sendRegistration(origin, request.path, request.body);
        assert.equal(response.status, 400);
        assert.match(String(response.body.error), /Daily007 profile name/i);
        assert.equal(registrationProfileTestDb.connectCount, 0);
        assert.equal(registrationProfileTestDb.registrations.length, 0);
        assert.equal(registrationProfileTestDb.ledger.length, 0);
        assert.equal(registrationProfileTestDb.user.wallet_coins, 100);
      });
    }
  } finally {
    registrationProfileTestDb.reset();
  }
});