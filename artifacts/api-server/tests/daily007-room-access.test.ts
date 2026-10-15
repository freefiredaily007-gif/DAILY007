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
  TEST_FULL_ADMIN_ID,
  TEST_BLOCKED_PLAYER_ID,
  TEST_BLOCKED_REGISTRATION_ID,
  TEST_MATCH_ID,
  TEST_PENDING_PLAYER_ID,
  TEST_PENDING_REGISTRATION_ID,
  TEST_REJECTED_PLAYER_ID,
  TEST_REJECTED_REGISTRATION_ID,
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
import {
  storedTournamentTimeFromInstant,
  tournamentInstantFromStored,
} from "../src/lib/daily007-schedule-time";

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
  method: "GET" | "DELETE" | "POST" | "PUT",
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

async function requestPublic(origin: string, path: string): Promise<JsonResult> {
  const response = await fetch(`${origin}${path}`);
  return { status: response.status, body: await response.json() };
}

function resetPublicTournamentAtReleaseTime(): void {
  roomAccessTestDb.reset();
  roomAccessTestDb.match.room_time = "PRIVATE-ROOM-TIME-820";
  setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS - 60_000));
}

function assertPublicTournamentOmitsRoomCredentials(tournament: any): void {
  assert.equal(
    isRoomCredentialReleaseOpen(new Date(tournament.startsAt), Date.now()),
    true,
    "The fixture should be past the scheduled credential-release time.",
  );
  const serialized = JSON.stringify(tournament);
  for (const field of ["roomId", "roomPassword", "roomTime"]) {
    assert.equal(field in tournament, false, `${field} must be omitted from public tournament data`);
  }
  for (const secret of [
    roomAccessTestDb.match.room_id,
    roomAccessTestDb.match.room_password,
    roomAccessTestDb.match.room_time,
  ]) {
    assert.ok(secret);
    assert.equal(serialized.includes(secret), false, "Public tournament data must not contain room values");
  }
}

test("compat registrations gate room credentials by release time and approval status", async () => {
  roomAccessTestDb.reset();
  setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS + 60_000));

  const playerToken = makeToken(TEST_PLAYER_ID, 0);
  const pendingPlayerToken = makeToken(TEST_PENDING_PLAYER_ID, 0);
  const unregisteredPlayerToken = makeToken(TEST_UNREGISTERED_PLAYER_ID, 0);
  const rejectedPlayerToken = makeToken(TEST_REJECTED_PLAYER_ID, 0);
  assert.ok(playerToken);
  assert.ok(pendingPlayerToken);
  assert.ok(unregisteredPlayerToken);
  assert.ok(rejectedPlayerToken);

  await withServer(async (origin) => {
    const playerRegistrations = await request(origin, "/my/registrations", "GET", playerToken);
    assert.equal(playerRegistrations.status, 200);
    assert.deepEqual(playerRegistrations.body.map((registration: any) => registration.id), [
      TEST_REGISTRATION_ID,
    ]);
    assert.equal(Number.isFinite(playerRegistrations.body[0].serverNowMs), true);

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
    assert.equal(
      playerRegistrations.body[0].roomPublished,
      true,
      "A prepared room must not be treated as authorization before server release.",
    );

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

    const rejectedAtBoundary = await request(origin, "/my/registrations", "GET", rejectedPlayerToken);
    assert.equal(rejectedAtBoundary.status, 200);
    assert.deepEqual(rejectedAtBoundary.body.map((registration: any) => registration.id), [
      TEST_REJECTED_REGISTRATION_ID,
    ]);
    assert.equal(rejectedAtBoundary.body[0].status, "rejected");
    for (const field of ["roomId", "roomPassword", "roomTime"]) {
      assert.equal(field in rejectedAtBoundary.body[0], false);
      assert.equal(field in rejectedAtBoundary.body[0].tournament, false);
    }
  });
});

test("compat registrations keep cancelled tournaments visible without retained room credentials", async () => {
  roomAccessTestDb.reset();
  roomAccessTestDb.match.status = "cancelled";
  roomAccessTestDb.match.room_time = "PRIVATE-ROOM-TIME-662";

  const playerToken = makeToken(TEST_PLAYER_ID, 0);
  assert.ok(playerToken);

  await withServer(async (origin) => {
    const response = await request(origin, "/my/registrations", "GET", playerToken);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map((registration: any) => registration.id), [
      TEST_REGISTRATION_ID,
    ]);

    const registration = response.body[0];
    assert.equal(registration.status, "approved");
    assert.equal(registration.playerName, "Approved Player");
    assert.equal(registration.tournament.id, TEST_MATCH_ID);
    assert.equal(registration.tournament.name, "Room Access Test");
    assert.equal(registration.tournament.status, "cancelled");
    assert.equal(registration.roomPublished, false);

    const serialized = JSON.stringify(registration);
    for (const field of ["roomId", "roomPassword", "roomTime"]) {
      assert.equal(field in registration, false, `${field} must be omitted from the registration`);
      assert.equal(
        field in registration.tournament,
        false,
        `${field} must be omitted from the nested tournament`,
      );
    }
    for (const storedValue of [
      roomAccessTestDb.match.room_id,
      roomAccessTestDb.match.room_password,
      roomAccessTestDb.match.room_time,
    ]) {
      assert.ok(storedValue);
      assert.equal(
        serialized.includes(storedValue),
        false,
        "Cancelled registration data must not contain retained room values.",
      );
    }
  });
});

test("public compatibility tournament listing omits room fields after credential release", async () => {
  resetPublicTournamentAtReleaseTime();

  await withServer(async (origin) => {
    const listing = await requestPublic(origin, "/tournaments");
    assert.equal(listing.status, 200);
    assert.equal(Array.isArray(listing.body), true);
    assert.equal(listing.body.length, 1);
    assert.equal(listing.body[0].id, TEST_MATCH_ID);
    assertPublicTournamentOmitsRoomCredentials(listing.body[0]);
  });
});

test("public compatibility tournament detail omits room fields after credential release", async () => {
  resetPublicTournamentAtReleaseTime();

  await withServer(async (origin) => {
    const detail = await requestPublic(origin, `/tournaments/${TEST_MATCH_ID}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.id, TEST_MATCH_ID);
    assertPublicTournamentOmitsRoomCredentials(detail.body);
  });
});

test("public compatibility tournament participants omit room fields after credential release", async () => {
  resetPublicTournamentAtReleaseTime();
  assert.equal(
    isRoomCredentialReleaseOpen(
      tournamentInstantFromStored(roomAccessTestDb.match.starts_at),
      Date.now(),
    ),
    true,
    "The fixture should be past the scheduled credential-release time.",
  );

  await withServer(async (origin) => {
    const roster = await requestPublic(origin, `/tournaments/${TEST_MATCH_ID}/participants`);
    assert.equal(roster.status, 200);
    assert.equal(roster.body.tournamentId, TEST_MATCH_ID);
    assert.equal(Array.isArray(roster.body.participants), true);
    assert.equal(roster.body.participants.length, 2);

    const serialized = JSON.stringify(roster.body);
    for (const field of ["roomId", "roomPassword", "roomTime"]) {
      assert.equal(
        serialized.includes(`"${field}"`),
        false,
        `${field} must be omitted throughout the public participant response.`,
      );
    }
    for (const credential of [
      roomAccessTestDb.match.room_id,
      roomAccessTestDb.match.room_password,
      roomAccessTestDb.match.room_time,
    ]) {
      assert.ok(credential);
      assert.equal(
        serialized.includes(credential),
        false,
        "The public participant response must not contain fixture room credentials.",
      );
    }
  });
});

test("v2 room endpoint requires approval and an open release window", async () => {
  roomAccessTestDb.reset();
  setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS + 60_000));

  const playerToken = makeToken(TEST_PLAYER_ID, 0);
  const pendingPlayerToken = makeToken(TEST_PENDING_PLAYER_ID, 0);
  const unregisteredPlayerToken = makeToken(TEST_UNREGISTERED_PLAYER_ID, 0);
  const rejectedPlayerToken = makeToken(TEST_REJECTED_PLAYER_ID, 0);
  assert.ok(playerToken);
  assert.ok(pendingPlayerToken);
  assert.ok(unregisteredPlayerToken);
  assert.ok(rejectedPlayerToken);

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

    for (const token of [pendingPlayerToken, unregisteredPlayerToken, rejectedPlayerToken]) {
      const denied = await request(origin, path, "GET", token);
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error, "Room credentials are available only to registered users.");
      assert.equal("roomId" in denied.body, false);
      assert.equal("roomPassword" in denied.body, false);
      const serializedDenial = JSON.stringify(denied.body);
      assert.equal(serializedDenial.includes("TEST-ROOM-820"), false);
      assert.equal(serializedDenial.includes("fixture-only-password"), false);
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

test("unapproved players cannot access replacement room credentials after release opens", async () => {
  roomAccessTestDb.reset();
  setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS + 60_000));

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  const pendingPlayerToken = makeToken(TEST_PENDING_PLAYER_ID, 0);
  const rejectedPlayerToken = makeToken(TEST_REJECTED_PLAYER_ID, 0);
  const unregisteredPlayerToken = makeToken(TEST_UNREGISTERED_PLAYER_ID, 0);
  assert.ok(adminToken);
  assert.ok(pendingPlayerToken);
  assert.ok(rejectedPlayerToken);
  assert.ok(unregisteredPlayerToken);

  const replacementCredentials = {
    roomId: "REPLACEMENT-ROOM-661",
    roomPassword: "replacement-password-661",
  };

  await withServer(async (origin) => {
    const saved = await request(
      origin,
      `/admin/tournaments/${TEST_MATCH_ID}/room`,
      "PUT",
      adminToken,
      replacementCredentials,
    );
    assert.equal(saved.status, 200);
    assert.equal(roomAccessTestDb.match.room_id, replacementCredentials.roomId);
    assert.equal(roomAccessTestDb.match.room_password, replacementCredentials.roomPassword);

    setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS - 60_000));
    assert.equal(
      isRoomCredentialReleaseOpen(
        tournamentInstantFromStored(roomAccessTestDb.match.starts_at),
        Date.now(),
      ),
      true,
      "The replacement credentials should be tested after the release window opens.",
    );

    const players = [
      {
        label: "pending",
        token: pendingPlayerToken,
        expectedRegistrationId: TEST_PENDING_REGISTRATION_ID,
        expectedStatus: "pending",
      },
      {
        label: "rejected",
        token: rejectedPlayerToken,
        expectedRegistrationId: TEST_REJECTED_REGISTRATION_ID,
        expectedStatus: "rejected",
      },
      {
        label: "unregistered",
        token: unregisteredPlayerToken,
      },
    ];

    for (const player of players) {
      const compatibility = await request(origin, "/my/registrations", "GET", player.token);
      assert.equal(compatibility.status, 200, `${player.label} compatibility request should succeed`);
      if (player.expectedRegistrationId) {
        assert.deepEqual(
          compatibility.body.map((registration: any) => registration.id),
          [player.expectedRegistrationId],
        );
        const registration = compatibility.body[0];
        assert.equal(registration.status, player.expectedStatus);
        for (const field of ["roomId", "roomPassword", "roomTime"]) {
          assert.equal(field in registration, false, `${player.label} registration must omit ${field}`);
          assert.equal(
            field in registration.tournament,
            false,
            `${player.label} nested tournament must omit ${field}`,
          );
        }
      } else {
        assert.deepEqual(compatibility.body, []);
      }

      const compatibilitySerialized = JSON.stringify(compatibility.body);
      assert.equal(compatibilitySerialized.includes(replacementCredentials.roomId), false);
      assert.equal(compatibilitySerialized.includes(replacementCredentials.roomPassword), false);

      const v2 = await request(
        origin,
        `/daily007/v2/matches/${TEST_MATCH_ID}/room`,
        "GET",
        player.token,
      );
      assert.equal(v2.status, 403, `${player.label} v2 request should be denied`);
      assert.equal("roomId" in v2.body, false);
      assert.equal("roomPassword" in v2.body, false);
      const v2Serialized = JSON.stringify(v2.body);
      assert.equal(v2Serialized.includes(replacementCredentials.roomId), false);
      assert.equal(v2Serialized.includes(replacementCredentials.roomPassword), false);
    }
  });
});

test("blocked player with an approved registration is denied room credentials from both player APIs", async () => {
  roomAccessTestDb.reset();
  roomAccessTestDb.registrations.push({
    id: TEST_BLOCKED_REGISTRATION_ID,
    match_id: TEST_MATCH_ID,
    captain_user_id: TEST_BLOCKED_PLAYER_ID,
    captain_name: "Blocked Player",
    captain_game_name: "BlockedCaptain",
    captain_game_uid: "FF-BLOCKED-001",
    team_name: "",
    entry_coins_paid: 5,
    status: "approved",
    created_at: new Date("2020-01-04T00:00:00.000Z"),
  });
  setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS - 60_000));

  const blockedRegistration = roomAccessTestDb.registrations.find(
    (registration) => registration.id === TEST_BLOCKED_REGISTRATION_ID,
  );
  assert.equal(blockedRegistration?.captain_user_id, TEST_BLOCKED_PLAYER_ID);
  assert.equal(blockedRegistration?.status, "approved");
  assert.equal(
    isRoomCredentialReleaseOpen(
      tournamentInstantFromStored(roomAccessTestDb.match.starts_at),
      Date.now(),
    ),
    true,
    "The blocked player's approved registration should be tested after room release opens.",
  );

  const blockedUser = roomAccessTestDb.users.get(TEST_BLOCKED_PLAYER_ID);
  assert.ok(blockedUser);
  blockedUser.status = "active";
  const blockedToken = makeToken(TEST_BLOCKED_PLAYER_ID, blockedUser.auth_version);
  assert.ok(blockedToken);
  blockedUser.status = "blocked";

  await withServer(async (origin) => {
    const deniedResponses = [
      {
        endpoint: "/my/registrations",
        response: await request(origin, "/my/registrations", "GET", blockedToken),
      },
      {
        endpoint: "v2 room",
        response: await request(
          origin,
          `/daily007/v2/matches/${TEST_MATCH_ID}/room`,
          "GET",
          blockedToken,
        ),
      },
    ];

    for (const { endpoint, response } of deniedResponses) {
      assert.equal(response.status, 403, `${endpoint} should deny the blocked account.`);
      assert.deepEqual(response.body, { error: "This account is blocked." });
      for (const field of ["roomId", "roomPassword", "roomTime"]) {
        assert.equal(
          field in response.body,
          false,
          `${endpoint} denial must not include ${field}.`,
        );
      }
      const serialized = JSON.stringify(response.body);
      for (const credential of [
        roomAccessTestDb.match.room_id,
        roomAccessTestDb.match.room_password,
        roomAccessTestDb.match.room_time,
      ]) {
        assert.ok(credential);
        assert.equal(
          serialized.includes(credential),
          false,
          `${endpoint} denial must not contain fixture room credentials.`,
        );
      }
    }
  });
});

test("clearing and compatibility-saving room credentials preserves registrations and exposes only replacement values", async () => {
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
      roomId: "COMPAT-ROOM-REPLACEMENT-820",
      roomPassword: "compat-replacement-fixture-password",
    };
    const saved = await request(
      origin,
      `/admin/tournaments/${TEST_MATCH_ID}/room`,
      "PUT",
      adminToken,
      replacementCredentials,
    );
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, {
      id: TEST_MATCH_ID,
      roomPublished: true,
      roomTime: matchBefore.room_time,
      ...replacementCredentials,
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

    setMatchStartInstant(new Date(Date.now() + ROOM_CREDENTIAL_REVEAL_LEAD_MS - 60_000));

    const publicListingAfterSave = await requestPublic(origin, "/tournaments");
    assert.equal(publicListingAfterSave.status, 200);
    assert.equal(publicListingAfterSave.body.length, 1);
    assertPublicTournamentOmitsRoomCredentials(publicListingAfterSave.body[0]);

    const publicDetailAfterSave = await requestPublic(
      origin,
      `/tournaments/${TEST_MATCH_ID}`,
    );
    assert.equal(publicDetailAfterSave.status, 200);
    assertPublicTournamentOmitsRoomCredentials(publicDetailAfterSave.body);

    const publicParticipantsAfterSave = await requestPublic(
      origin,
      `/tournaments/${TEST_MATCH_ID}/participants`,
    );
    assert.equal(publicParticipantsAfterSave.status, 200);
    assert.equal(publicParticipantsAfterSave.body.tournamentId, TEST_MATCH_ID);
    assert.equal(Array.isArray(publicParticipantsAfterSave.body.participants), true);
    const publicParticipantsSerialized = JSON.stringify(publicParticipantsAfterSave.body);
    for (const field of ["roomId", "roomPassword", "roomTime"]) {
      assert.equal(
        publicParticipantsSerialized.includes(`"${field}"`),
        false,
        `${field} must be omitted from public participants after a compatibility room save.`,
      );
    }
    for (const credential of [
      replacementCredentials.roomId,
      replacementCredentials.roomPassword,
      roomAccessTestDb.match.room_time,
    ]) {
      assert.equal(
        publicParticipantsSerialized.includes(credential),
        false,
        "Public participants must not contain replacement room credentials or room time.",
      );
    }

    roomAccessTestDb.match.starts_at = matchBefore.starts_at;
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

test("v2 admin room saves remain supported by the isolated room-access fixture", async () => {
  roomAccessTestDb.reset();

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  assert.ok(adminToken);
  const matchBefore = structuredClone(roomAccessTestDb.match);
  const registrationsBefore = structuredClone(roomAccessTestDb.registrations);
  const replacementCredentials = {
    roomId: "V2-ROOM-REPLACEMENT-820",
    roomPassword: "v2-replacement-fixture-password",
  };

  await withServer(async (origin) => {
    const saved = await request(
      origin,
      `/daily007/v2/admin/matches/${TEST_MATCH_ID}/room`,
      "PUT",
      adminToken,
      replacementCredentials,
    );

    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, {
      match: { id: TEST_MATCH_ID, published: true },
    });
    assert.equal(roomAccessTestDb.match.room_id, replacementCredentials.roomId);
    assert.equal(roomAccessTestDb.match.room_password, replacementCredentials.roomPassword);
    assert.equal(roomAccessTestDb.match.room_published, true);
    assert.equal(roomAccessTestDb.match.status, matchBefore.status);
    assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
  });
});

test("Full Admins can save and publish room credentials through both admin APIs without changing tournament status or registrations", async () => {
  const fullAdminToken = makeToken(TEST_FULL_ADMIN_ID, 0);
  assert.ok(fullAdminToken);
  const routes = [
    {
      label: "v2",
      path: `/daily007/v2/admin/matches/${TEST_MATCH_ID}/room`,
      credentials: {
        roomId: "FULL-ADMIN-V2-ROOM",
        roomPassword: "full-admin-v2-password",
      },
    },
    {
      label: "compatibility",
      path: `/admin/tournaments/${TEST_MATCH_ID}/room`,
      credentials: {
        roomId: "FULL-ADMIN-COMPAT-ROOM",
        roomPassword: "full-admin-compat-password",
      },
    },
  ];

  await withServer(async (origin) => {
    for (const route of routes) {
      roomAccessTestDb.reset();
      const matchBefore = structuredClone(roomAccessTestDb.match);
      const registrationsBefore = structuredClone(roomAccessTestDb.registrations);

      const saved = await request(
        origin,
        route.path,
        "PUT",
        fullAdminToken,
        route.credentials,
      );

      assert.equal(saved.status, 200, `${route.label} should accept a Full Admin token`);
      if (route.label === "v2") {
        assert.deepEqual(saved.body, {
          match: { id: TEST_MATCH_ID, published: true },
        });
      } else {
        assert.deepEqual(saved.body, {
          id: TEST_MATCH_ID,
          roomPublished: true,
          roomTime: matchBefore.room_time,
          ...route.credentials,
        });
      }

      assert.equal(roomAccessTestDb.match.room_id, route.credentials.roomId);
      assert.equal(roomAccessTestDb.match.room_password, route.credentials.roomPassword);
      assert.equal(roomAccessTestDb.match.room_published, true);
      assert.equal(roomAccessTestDb.match.status, matchBefore.status);
      assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
    }
  });
});

test("players cannot replace or publish room credentials through either admin save API", async () => {
  const playerToken = makeToken(TEST_PLAYER_ID, 0);
  assert.ok(playerToken);
  const routes = [
    {
      label: "v2",
      path: `/daily007/v2/admin/matches/${TEST_MATCH_ID}/room`,
    },
    {
      label: "compatibility",
      path: `/admin/tournaments/${TEST_MATCH_ID}/room`,
    },
  ];
  const replacementCredentials = {
    roomId: "PLAYER-REPLACEMENT-ROOM",
    roomPassword: "player-replacement-password",
  };

  await withServer(async (origin) => {
    for (const route of routes) {
      roomAccessTestDb.reset();
      roomAccessTestDb.match.room_published = false;
      const matchBefore = structuredClone(roomAccessTestDb.match);
      const registrationsBefore = structuredClone(roomAccessTestDb.registrations);

      const rejected = await request(
        origin,
        route.path,
        "PUT",
        playerToken,
        replacementCredentials,
      );

      assert.equal(rejected.status, 403, `${route.label} must deny a player token`);
      assert.deepEqual(rejected.body, {
        error: "Tournament administrator access is required.",
      });
      assert.equal(roomAccessTestDb.match.room_id, matchBefore.room_id);
      assert.equal(roomAccessTestDb.match.room_password, matchBefore.room_password);
      assert.equal(roomAccessTestDb.match.room_published, matchBefore.room_published);
      assert.equal(roomAccessTestDb.match.status, matchBefore.status);
      assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
    }
  });
});

test("compatibility room saves reject cancelled tournaments without changing room or registration state", async () => {
  roomAccessTestDb.reset();
  roomAccessTestDb.match.status = "cancelled";

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  assert.ok(adminToken);
  const matchBefore = structuredClone(roomAccessTestDb.match);
  const registrationsBefore = structuredClone(roomAccessTestDb.registrations);

  await withServer(async (origin) => {
    const rejected = await request(
      origin,
      `/admin/tournaments/${TEST_MATCH_ID}/room`,
      "PUT",
      adminToken,
      {
        roomId: "REPLACEMENT-CANCELLED-ROOM",
        roomPassword: "replacement-cancelled-password",
      },
    );

    assert.equal(rejected.status, 409);
    assert.deepEqual(rejected.body, {
      error: "A cancelled tournament has no room to manage.",
    });
    assert.deepEqual(roomAccessTestDb.match, matchBefore);
    assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
  });
});

test("v2 room saves reject cancelled tournaments without changing room or registration state", async () => {
  roomAccessTestDb.reset();
  roomAccessTestDb.match.status = "cancelled";

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  assert.ok(adminToken);
  const matchBefore = structuredClone(roomAccessTestDb.match);
  const registrationsBefore = structuredClone(roomAccessTestDb.registrations);

  await withServer(async (origin) => {
    const rejected = await request(
      origin,
      `/daily007/v2/admin/matches/${TEST_MATCH_ID}/room`,
      "PUT",
      adminToken,
      {
        roomId: "REPLACEMENT-CANCELLED-V2-ROOM",
        roomPassword: "replacement-cancelled-v2-password",
      },
    );

    assert.equal(rejected.status, 404);
    assert.deepEqual(rejected.body, {
      error: "Match not found or cancelled.",
    });
    assert.deepEqual(roomAccessTestDb.match, matchBefore);
    assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
  });
});

test("legacy room publishing only marks saved credentials as published for manageable tournaments", async () => {
  roomAccessTestDb.reset();
  roomAccessTestDb.match.room_published = false;

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  assert.ok(adminToken);
  const matchBefore = structuredClone(roomAccessTestDb.match);
  const registrationsBefore = structuredClone(roomAccessTestDb.registrations);

  await withServer(async (origin) => {
    const published = await request(
      origin,
      `/admin/tournaments/${TEST_MATCH_ID}/publish-room`,
      "POST",
      adminToken,
    );

    assert.equal(published.status, 200);
    assert.deepEqual(published.body, {
      id: TEST_MATCH_ID,
      roomPublished: true,
    });
    assert.equal(roomAccessTestDb.match.room_id, matchBefore.room_id);
    assert.equal(roomAccessTestDb.match.room_password, matchBefore.room_password);
    assert.equal(roomAccessTestDb.match.room_published, true);
    assert.equal(roomAccessTestDb.match.status, matchBefore.status);
    assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
  });
});

test("Full Admins can clear and republish room credentials through compatibility admin actions", async () => {
  const fullAdminToken = makeToken(TEST_FULL_ADMIN_ID, 0);
  assert.ok(fullAdminToken);

  roomAccessTestDb.reset();
  roomAccessTestDb.match.room_published = false;
  const beforeRepublish = structuredClone(roomAccessTestDb.match);
  const registrationsBeforeRepublish = structuredClone(roomAccessTestDb.registrations);

  await withServer(async (origin) => {
    const republished = await request(
      origin,
      `/admin/tournaments/${TEST_MATCH_ID}/publish-room`,
      "POST",
      fullAdminToken,
    );

    assert.equal(republished.status, 200);
    assert.deepEqual(republished.body, {
      id: TEST_MATCH_ID,
      roomPublished: true,
    });
    assert.equal(roomAccessTestDb.match.room_id, beforeRepublish.room_id);
    assert.equal(roomAccessTestDb.match.room_password, beforeRepublish.room_password);
    assert.equal(roomAccessTestDb.match.room_time, beforeRepublish.room_time);
    assert.equal(roomAccessTestDb.match.room_published, true);
    assert.equal(roomAccessTestDb.match.status, beforeRepublish.status);
    assert.deepEqual(roomAccessTestDb.registrations, registrationsBeforeRepublish);

    roomAccessTestDb.reset();
    const beforeClear = structuredClone(roomAccessTestDb.match);
    const registrationsBeforeClear = structuredClone(roomAccessTestDb.registrations);

    const cleared = await request(
      origin,
      `/admin/tournaments/${TEST_MATCH_ID}/room`,
      "DELETE",
      fullAdminToken,
    );

    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body, {
      success: true,
      roomPublished: false,
    });
    assert.equal(roomAccessTestDb.match.room_id, null);
    assert.equal(roomAccessTestDb.match.room_password, null);
    assert.equal(roomAccessTestDb.match.room_time, beforeClear.room_time);
    assert.equal(roomAccessTestDb.match.room_published, false);
    assert.equal(roomAccessTestDb.match.status, beforeClear.status);
    assert.deepEqual(roomAccessTestDb.registrations, registrationsBeforeClear);
  });
});

test("legacy room publishing rejects cancelled tournaments without changing retained room or registration state", async () => {
  roomAccessTestDb.reset();
  roomAccessTestDb.match.status = "cancelled";
  roomAccessTestDb.match.room_published = false;

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  assert.ok(adminToken);
  const matchBefore = structuredClone(roomAccessTestDb.match);
  const registrationsBefore = structuredClone(roomAccessTestDb.registrations);

  await withServer(async (origin) => {
    const rejected = await request(
      origin,
      `/admin/tournaments/${TEST_MATCH_ID}/publish-room`,
      "POST",
      adminToken,
    );

    assert.equal(rejected.status, 409);
    assert.deepEqual(rejected.body, {
      error: "A cancelled tournament has no room to publish.",
    });
    assert.deepEqual(roomAccessTestDb.match, matchBefore);
    assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
  });
});

test("both admin room save APIs accept and preserve 200-character credentials", async () => {
  roomAccessTestDb.reset();

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  const playerToken = makeToken(TEST_PLAYER_ID, 0);
  assert.ok(adminToken);
  assert.ok(playerToken);
  const matchBefore = structuredClone(roomAccessTestDb.match);
  const registrationsBefore = structuredClone(roomAccessTestDb.registrations);
  const credentials = {
    roomId: "R".repeat(200),
    roomPassword: "P".repeat(200),
  };
  const routes = [
    {
      label: "v2",
      path: `/daily007/v2/admin/matches/${TEST_MATCH_ID}/room`,
    },
    {
      label: "compatibility",
      path: `/admin/tournaments/${TEST_MATCH_ID}/room`,
    },
  ];

  await withServer(async (origin) => {
    for (const route of routes) {
      const saved = await request(
        origin,
        route.path,
        "PUT",
        adminToken,
        credentials,
      );

      assert.equal(saved.status, 200, `${route.label} should accept 200-character credentials`);
      if (route.label === "v2") {
        assert.deepEqual(saved.body, {
          match: { id: TEST_MATCH_ID, published: true },
        });
      } else {
        assert.deepEqual(saved.body, {
          id: TEST_MATCH_ID,
          roomPublished: true,
          roomTime: matchBefore.room_time,
          ...credentials,
        });
      }

      assert.equal(roomAccessTestDb.match.room_id, credentials.roomId);
      assert.equal(roomAccessTestDb.match.room_password, credentials.roomPassword);
      assert.equal(roomAccessTestDb.match.room_id?.length, 200);
      assert.equal(roomAccessTestDb.match.room_password?.length, 200);
      assert.equal(roomAccessTestDb.match.room_published, true);
      assert.equal(roomAccessTestDb.match.status, matchBefore.status);
      assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);

      const readBack = await request(
        origin,
        `/admin/tournaments/${TEST_MATCH_ID}/room`,
        "GET",
        adminToken,
      );
      assert.equal(readBack.status, 200);
      assert.deepEqual(readBack.body, {
        id: TEST_MATCH_ID,
        roomId: credentials.roomId,
        roomPassword: credentials.roomPassword,
        roomTime: matchBefore.room_time,
        roomPublished: true,
      });

      const v2PlayerRead = await request(
        origin,
        `/daily007/v2/matches/${TEST_MATCH_ID}/room`,
        "GET",
        playerToken,
      );
      assert.equal(v2PlayerRead.status, 200);
      assert.deepEqual(v2PlayerRead.body, credentials);
      assert.equal(v2PlayerRead.body.roomId.length, 200);
      assert.equal(v2PlayerRead.body.roomPassword.length, 200);

      const compatibilityPlayerRead = await request(
        origin,
        "/my/registrations",
        "GET",
        playerToken,
      );
      assert.equal(compatibilityPlayerRead.status, 200);
      assert.equal(compatibilityPlayerRead.body[0].roomId, credentials.roomId);
      assert.equal(compatibilityPlayerRead.body[0].roomPassword, credentials.roomPassword);
      assert.equal(compatibilityPlayerRead.body[0].tournament.roomId, credentials.roomId);
      assert.equal(compatibilityPlayerRead.body[0].tournament.roomPassword, credentials.roomPassword);
      assert.equal(compatibilityPlayerRead.body[0].roomId.length, 200);
      assert.equal(compatibilityPlayerRead.body[0].roomPassword.length, 200);
    }
  });
});

test("both admin room save APIs reject blank or oversized credentials without changing saved room state", async () => {
  roomAccessTestDb.reset();

  const adminToken = makeToken(TEST_ADMIN_ID, 0);
  assert.ok(adminToken);
  const matchBefore = structuredClone(roomAccessTestDb.match);
  const registrationsBefore = structuredClone(roomAccessTestDb.registrations);
  const routes = [
    {
      label: "v2",
      path: `/daily007/v2/admin/matches/${TEST_MATCH_ID}/room`,
    },
    {
      label: "compatibility",
      path: `/admin/tournaments/${TEST_MATCH_ID}/room`,
    },
  ];
  const invalidValues = [
    { field: "roomId", value: "", description: "empty room ID" },
    { field: "roomId", value: "   ", description: "whitespace-only room ID" },
    { field: "roomId", value: "R".repeat(201), description: "oversized room ID" },
    { field: "roomPassword", value: "", description: "empty room password" },
    { field: "roomPassword", value: "   ", description: "whitespace-only room password" },
    { field: "roomPassword", value: "P".repeat(201), description: "oversized room password" },
  ];

  await withServer(async (origin) => {
    for (const route of routes) {
      for (const invalid of invalidValues) {
        const credentials = {
          roomId: "VALID-ROOM-REPLACEMENT",
          roomPassword: "valid-room-password",
          [invalid.field]: invalid.value,
        };
        const response = await request(
          origin,
          route.path,
          "PUT",
          adminToken,
          credentials,
        );

        assert.equal(
          response.status,
          400,
          `${route.label} should reject ${invalid.description}`,
        );
        assert.deepEqual(
          {
            roomId: roomAccessTestDb.match.room_id,
            roomPassword: roomAccessTestDb.match.room_password,
            roomPublished: roomAccessTestDb.match.room_published,
          },
          {
            roomId: matchBefore.room_id,
            roomPassword: matchBefore.room_password,
            roomPublished: matchBefore.room_published,
          },
          `${route.label} must preserve saved credentials after rejecting ${invalid.description}`,
        );
        assert.equal(roomAccessTestDb.match.status, matchBefore.status);
        assert.deepEqual(roomAccessTestDb.registrations, registrationsBefore);
      }
    }
  });
});