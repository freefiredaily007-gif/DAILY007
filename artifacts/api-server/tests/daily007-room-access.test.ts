import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import test, { after } from "node:test";
import daily007CompatCoreRouter from "../src/routes/daily007-compat-core";
import daily007V2Router from "../src/routes/daily007-v2";
import { makeToken } from "../src/lib/daily007-session-token";
import {
  roomAccessTestDb,
  TEST_ADMIN_ID,
  TEST_MATCH_ID,
  TEST_PENDING_PLAYER_ID,
  TEST_PENDING_REGISTRATION_ID,
  TEST_PLAYER_ID,
  TEST_REGISTRATION_ID,
  TEST_UNREGISTERED_PLAYER_ID,
} from "./support/daily007-room-access-test-db";
import {
  canRevealRoomCredentials,
  isRoomCredentialReleaseOpen,
  ROOM_CREDENTIAL_REVEAL_LEAD_MS,
  type RoomCredentialAccessState,
} from "../src/lib/daily007-room-access.ts";
import { storedTournamentTimeFromInstant } from "../src/lib/daily007-schedule-time";

function setMatchStartInstant(instant: Date): void {
  roomAccessTestDb.match.starts_at = storedTournamentTimeFromInstant(instant);
}

const startsAt = new Date("2030-04-05T12:00:00.000Z");
const eligible: RoomCredentialAccessState = {
  registrationStatus: "approved",
  tournamentStatus: "ongoing",
  roomId: "ROOM-123",
  roomPassword: "secret",
  startsAt,
};

test("room credentials unlock exactly five minutes before the scheduled start", () => {
  const startMs = startsAt.getTime();

  assert.equal(isRoomCredentialReleaseOpen(startsAt, startMs - 5 * 60 * 1000 - 1), false);
  assert.equal(isRoomCredentialReleaseOpen(startsAt, startMs - 5 * 60 * 1000), true);
  assert.equal(isRoomCredentialReleaseOpen(startsAt, startMs), true);
});

test("credentials are not returned to unregistered, pending, cancelled, or unprepared accounts", () => {
  const releaseTime = startsAt.getTime() - 5 * 60 * 1000;

  assert.equal(canRevealRoomCredentials(eligible, releaseTime), true);
  assert.equal(canRevealRoomCredentials({ ...eligible, registrationStatus: "none" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, registrationStatus: "pending" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, registrationStatus: "rejected" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, tournamentStatus: "cancelled" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, roomId: null }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, roomPassword: "" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, startsAt: null }, releaseTime), false);
});

const TEST_AUTH_SECRET = "daily007-room-clear-test-secret-at-least-32-chars";
const previousAuthSecret = process.env.DAILY007_AUTH_SECRET;
process.env.DAILY007_AUTH_SECRET = TEST_AUTH_SECRET;

after(() => {
  roomAccessTestDb.reset();
  if (previousAuthSecret === undefined) delete process.env.DAILY007_AUTH_SECRET;
  else process.env.DAILY007_AUTH_SECRET = previousAuthSecret;
});

type JsonResult = { status: number; body: any };

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

async function request(
  origin: string,
  path: string,
  method: "GET" | "DELETE" | "PUT",
  token: string,
  body?: unknown,
): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("compat registrations are caller-scoped and hide room credentials before release", async () => {
  roomAccessTestDb.reset();
  setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS + 60_000));

  const playerToken = makeToken(TEST_PLAYER_ID, 0);
  const pendingPlayerToken = makeToken(TEST_PENDING_PLAYER_ID, 0);
  const unregisteredPlayerToken = makeToken(TEST_UNREGISTERED_PLAYER_ID, 0);
  assert.ok(playerToken);
  assert.ok(pendingPlayerToken);
  assert.ok(unregisteredPlayerToken);

  await withServer(async (origin) => {
    const playerRegistrations = await request(origin, "/my/registrations", "GET", playerToken);
    assert.equal(playerRegistrations.status, 200);
    assert.deepEqual(playerRegistrations.body.map((registration: any) => registration.id), [
      TEST_REGISTRATION_ID,
    ]);

    const pendingRegistrations = await request(
      origin,
      "/my/registrations",
      "GET",
      pendingPlayerToken,
    );
    assert.equal(pendingRegistrations.status, 200);
    assert.deepEqual(pendingRegistrations.body.map((registration: any) => registration.id), [
      TEST_PENDING_REGISTRATION_ID,
    ]);

    const unregisteredRegistrations = await request(
      origin,
      "/my/registrations",
      "GET",
      unregisteredPlayerToken,
    );
    assert.equal(unregisteredRegistrations.status, 200);
    assert.deepEqual(unregisteredRegistrations.body, []);

    for (const registration of [
      playerRegistrations.body[0],
      pendingRegistrations.body[0],
    ]) {
      for (const field of ["roomId", "roomPassword", "roomTime"]) {
        assert.equal(field in registration, false, `${field} should be omitted from the registration`);
        assert.equal(
          field in registration.tournament,
          false,
          `${field} should be omitted from the nested tournament`,
        );
      }
    }

    const boundaryNow = Date.now();
    setMatchStartInstant(new Date(boundaryNow + ROOM_CREDENTIAL_REVEAL_LEAD_MS));
    const playerAtBoundary = await request(origin, "/my/registrations", "GET", playerToken);
    assert.equal(playerAtBoundary.status, 200);
    assert.equal(playerAtBoundary.body[0].roomId, "TEST-ROOM-820");
    assert.equal(playerAtBoundary.body[0].roomPassword, "fixture-only-password");
    assert.equal(playerAtBoundary.body[0].roomTime, "12:00 AM");
    assert.equal(playerAtBoundary.body[0].tournament.roomId, "TEST-ROOM-820");
    assert.equal(playerAtBoundary.body[0].tournament.roomPassword, "fixture-only-password");
    assert.equal(playerAtBoundary.body[0].tournament.roomTime, "12:00 AM");

    const pendingAtBoundary = await request(origin, "/my/registrations", "GET", pendingPlayerToken);
    assert.equal(pendingAtBoundary.status, 200);
    for (const field of ["roomId", "roomPassword", "roomTime"]) {
      assert.equal(field in pendingAtBoundary.body[0], false);
      assert.equal(field in pendingAtBoundary.body[0].tournament, false);
    }
  });
});

test("v2 room endpoint requires approval and an open release window", async () => {
  roomAccessTestDb.reset();
  setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS + 60_000));

  const playerToken = makeToken(TEST_PLAYER_ID, 0);
  const pendingPlayerToken = makeToken(TEST_PENDING_PLAYER_ID, 0);
  const unregisteredPlayerToken = makeToken(TEST_UNREGISTERED_PLAYER_ID, 0);
  assert.ok(playerToken);
  assert.ok(pendingPlayerToken);
  assert.ok(unregisteredPlayerToken);

  await withServer(async (origin) => {
    const path = `/daily007/v2/matches/${TEST_MATCH_ID}/room`;
    const beforeRelease = await request(origin, path, "GET", playerToken);
    assert.equal(beforeRelease.status, 403);
    assert.equal(
      beforeRelease.body.error,
      "Room credentials become available five minutes before the match starts.",
    );

    const boundaryNow = Date.now();
    setMatchStartInstant(new Date(boundaryNow + ROOM_CREDENTIAL_REVEAL_LEAD_MS));
    const approvedAtBoundary = await request(origin, path, "GET", playerToken);
    assert.equal(approvedAtBoundary.status, 200);
    assert.deepEqual(approvedAtBoundary.body, {
      roomId: "TEST-ROOM-820",
      roomPassword: "fixture-only-password",
    });

    for (const token of [pendingPlayerToken, unregisteredPlayerToken]) {
      const denied = await request(origin, path, "GET", token);
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error, "Room credentials are available only to registered users.");
    }

    roomAccessTestDb.match.status = "cancelled";
    const cancelled = await request(origin, path, "GET", playerToken);
    assert.equal(cancelled.status, 404);
    assert.equal(cancelled.body.error, "Room credentials are not available for this match.");

    roomAccessTestDb.match.status = "ongoing";
    roomAccessTestDb.match.room_id = null;
    const missingRoomId = await request(origin, path, "GET", playerToken);
    assert.equal(missingRoomId.status, 404);
    assert.equal(missingRoomId.body.error, "Room credentials are not available for this match.");

    roomAccessTestDb.match.room_id = "TEST-ROOM-820";
    roomAccessTestDb.match.room_password = null;
    const missingPassword = await request(origin, path, "GET", playerToken);
    assert.equal(missingPassword.status, 404);
    assert.equal(missingPassword.body.error, "Room credentials are not available for this match.");
  });
});

test("clearing and replacing room credentials preserves registrations and exposes only the replacement values", async () => {
  roomAccessTestDb.reset();

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  const playerToken = makeToken(TEST_PLAYER_ID, 0);
  assert.ok(adminToken);
  assert.ok(playerToken);

  const matchBefore = structuredClone(roomAccessTestDb.match);
  const registrationsBefore = structuredClone(roomAccessTestDb.registrations);

  await withServer(async (origin) => {
    const v2CredentialsBefore = await request(
      origin,
      `/daily007/v2/matches/${TEST_MATCH_ID}/room`,
      "GET",
      playerToken,
    );
    assert.equal(v2CredentialsBefore.status, 200);
    assert.deepEqual(v2CredentialsBefore.body, {
      roomId: matchBefore.room_id,
      roomPassword: matchBefore.room_password,
    });

    const legacyBefore = await request(origin, "/my/registrations", "GET", playerToken);
    assert.equal(legacyBefore.status, 200);
    assert.equal(legacyBefore.body[0].id, TEST_REGISTRATION_ID);
    assert.equal(legacyBefore.body[0].roomId, matchBefore.room_id);
    assert.equal(legacyBefore.body[0].roomPassword, matchBefore.room_password);

    const cleared = await request(
      origin,
      `/admin/tournaments/${TEST_MATCH_ID}/room`,
      "DELETE",
      adminToken,
    );
    assert.equal(cleared.status, 200);
    assert.equal(roomAccessTestDb.match.room_id, null);
    assert.equal(roomAccessTestDb.match.room_password, null);
    assert.equal(roomAccessTestDb.match.room_published, false);

    const v2CredentialsAfter = await request(
      origin,
      `/daily007/v2/matches/${TEST_MATCH_ID}/room`,
      "GET",
      playerToken,
    );
    assert.equal(v2CredentialsAfter.status, 404);
    assert.equal(v2CredentialsAfter.body.error, "Room credentials are not available for this match.");

    const legacyAfter = await request(origin, "/my/registrations", "GET", playerToken);
    assert.equal(legacyAfter.status, 200);
    assert.equal(legacyAfter.body[0].id, TEST_REGISTRATION_ID);
    assert.equal("roomId" in legacyAfter.body[0], false);
    assert.equal("roomPassword" in legacyAfter.body[0], false);
    assert.equal(legacyAfter.body[0].roomPublished, false);
    assert.equal("roomId" in legacyAfter.body[0].tournament, false);
    assert.equal("roomPassword" in legacyAfter.body[0].tournament, false);

    const replacementCredentials = {
      roomId: "TEST-ROOM-REPLACEMENT-820",
      roomPassword: "replacement-fixture-password",
    };
    const saved = await request(
      origin,
      `/daily007/v2/admin/matches/${TEST_MATCH_ID}/room`,
      "PUT",
      adminToken,
      replacementCredentials,
    );
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, {
      match: {
        id: TEST_MATCH_ID,
        published: true,
      },
    });
    assert.equal(roomAccessTestDb.match.room_id, replacementCredentials.roomId);
    assert.equal(roomAccessTestDb.match.room_password, replacementCredentials.roomPassword);
    assert.equal(roomAccessTestDb.match.room_published, true);

    const v2CredentialsAfterSave = await request(
      origin,
      `/daily007/v2/matches/${TEST_MATCH_ID}/room`,
      "GET",
      playerToken,
    );
    assert.equal(v2CredentialsAfterSave.status, 200);
    assert.deepEqual(v2CredentialsAfterSave.body, replacementCredentials);

    const legacyAfterSave = await request(origin, "/my/registrations", "GET", playerToken);
    assert.equal(legacyAfterSave.status, 200);
    assert.equal(legacyAfterSave.body[0].id, TEST_REGISTRATION_ID);
    assert.equal(legacyAfterSave.body[0].roomId, replacementCredentials.roomId);
    assert.equal(legacyAfterSave.body[0].roomPassword, replacementCredentials.roomPassword);
    assert.equal(legacyAfterSave.body[0].roomPublished, true);
    assert.equal(legacyAfterSave.body[0].tournament.roomId, replacementCredentials.roomId);
    assert.equal(legacyAfterSave.body[0].tournament.roomPassword, replacementCredentials.roomPassword);
    assert.equal(JSON.stringify(legacyAfterSave.body).includes(matchBefore.room_id!), false);
    assert.equal(JSON.stringify(legacyAfterSave.body).includes(matchBefore.room_password!), false);

    assert.equal(roomAccessTestDb.match.status, matchBefore.status);
    assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
    assert.deepEqual(
      {
        ...roomAccessTestDb.match,
        room_id: matchBefore.room_id,
        room_password: matchBefore.room_password,
        room_published: matchBefore.room_published,
      },
      matchBefore,
    );
  });
});