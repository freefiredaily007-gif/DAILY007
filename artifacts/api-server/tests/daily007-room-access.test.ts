import assert from "node:assert/strict";
import test from "node:test";
import {
  canRevealRoomCredentials,
  isRoomCredentialReleaseOpen,
  type RoomCredentialAccessState,
} from "../src/lib/daily007-room-access.ts";

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
  assert.equal(canRevealRoomCredentials({ ...eligible, registrationStatus: "pending" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, registrationStatus: "rejected" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, tournamentStatus: "cancelled" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, roomId: null }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, roomPassword: "" }, releaseTime), false);
  assert.equal(canRevealRoomCredentials({ ...eligible, startsAt: null }, releaseTime), false);
});