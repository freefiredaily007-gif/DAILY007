import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getRoomCredentialReleaseDelayMs,
  hasServerAuthorizedRoomCredentials,
} from "../src/lib/roomCredentialTiming.ts";

const panelSource = await readFile(
  new URL("../src/components/RoomCredentialsPanel.tsx", import.meta.url),
  "utf8",
);
const myMatchesSource = await readFile(
  new URL("../src/screens/MyMatches.tsx", import.meta.url),
  "utf8",
);

test("server response without room values stays hidden even when the phone clock is ahead", () => {
  const serverNow = Date.now();
  const startAt = serverNow + 6 * 60 * 1000;
  const fakeApprovedRegistrationBeforeRelease = {
    status: "approved",
    roomPublished: true,
    roomId: undefined,
    roomPassword: undefined,
    tournament: { startsAt: new Date(startAt).toISOString() },
  };
  const phoneClockAhead = serverNow + 60 * 60 * 1000;

  assert.ok(phoneClockAhead > startAt - 5 * 60 * 1000);
  assert.equal(
    hasServerAuthorizedRoomCredentials(
      fakeApprovedRegistrationBeforeRelease.roomId,
      fakeApprovedRegistrationBeforeRelease.roomPassword,
    ),
    false,
  );
});

test("released credentials display with the phone clock behind or ahead of server time", () => {
  const serverNow = Date.now();
  const startAt = serverNow - 60 * 1000;
  const releaseAt = startAt - 5 * 60 * 1000;
  const fakeApprovedRegistrationAfterRelease = {
    status: "approved",
    roomId: "FAKE-ROOM-295",
    roomPassword: "fake-password-295",
    tournament: { startsAt: new Date(startAt).toISOString() },
  };
  const phoneClockBehind = serverNow - 60 * 60 * 1000;
  const phoneClockAhead = serverNow + 60 * 60 * 1000;

  assert.ok(serverNow >= releaseAt);
  assert.ok(phoneClockBehind < releaseAt);
  assert.ok(phoneClockAhead > releaseAt);
  for (const phoneClock of [phoneClockBehind, phoneClockAhead]) {
    assert.notEqual(phoneClock, serverNow);
    assert.equal(
      hasServerAuthorizedRoomCredentials(
        fakeApprovedRegistrationAfterRelease.roomId,
        fakeApprovedRegistrationAfterRelease.roomPassword,
      ),
      true,
    );
  }

  assert.match(
    panelSource,
    /const credentialsReady = hasServerAuthorizedRoomCredentials\(id, password\);/,
  );
  assert.match(panelSource, /credentialsReady \? \(/);
  assert.match(
    myMatchesSource,
    /const roomReady = status === 'approved' && !cancelled &&\s+hasServerAuthorizedRoomCredentials\(roomId, roomPassword\);/,
  );
  assert.doesNotMatch(myMatchesSource, /roomWindowOpen/);
});

test("My Matches schedules a server-release refresh independently of phone clock skew", () => {
  const serverNow = Date.now();
  const releaseAt = serverNow + 60 * 1000;
  const phoneClocks = [
    serverNow - 60 * 60 * 1000,
    serverNow + 60 * 60 * 1000,
  ];

  for (const phoneClock of phoneClocks) {
    assert.notEqual(phoneClock, serverNow);
    assert.equal(getRoomCredentialReleaseDelayMs(releaseAt, serverNow), 60 * 1000);
  }
  assert.equal(getRoomCredentialReleaseDelayMs(serverNow - 1, serverNow), null);
  assert.match(myMatchesSource, /getRoomCredentialReleaseDelayMs\(schedule\.releaseAtMs, serverNowMs\)/);
});

test("empty or incomplete values cannot be mistaken for server-authorized credentials", () => {
  assert.equal(hasServerAuthorizedRoomCredentials("", "password"), false);
  assert.equal(hasServerAuthorizedRoomCredentials("room", ""), false);
  assert.equal(hasServerAuthorizedRoomCredentials("  ", "password"), false);
  assert.equal(hasServerAuthorizedRoomCredentials("room", null), false);
});
