import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { copyRoomCredentialToClipboard } from "../src/lib/roomCredentialCopy.ts";
import { shouldStackRoomCredentialRows } from "../src/lib/roomCredentialLayout.ts";
import {
  getRoomCredentialSchedule,
  hasServerAuthorizedRoomCredentials,
  ROOM_CREDENTIAL_REVEAL_LEAD_MS,
} from "../src/lib/roomCredentialTiming.ts";
import {
  fetchTournamentDetailSnapshot,
  startTournamentDetailPolling,
  TOURNAMENT_DETAIL_REFRESH_INTERVAL_MS,
} from "../src/lib/tournament-detail-refresh.ts";

const panelSource = await readFile(
  new URL("../src/components/RoomCredentialsPanel.tsx", import.meta.url),
  "utf8",
);
const detailSource = await readFile(
  new URL("../src/screens/TDetail.tsx", import.meta.url),
  "utf8",
);
const rowStart = panelSource.indexOf("function CredentialRow(");
const rowEnd = panelSource.indexOf("\nconst styles", rowStart);
assert.ok(rowStart >= 0 && rowEnd > rowStart, "The credential row component must remain present.");
const rowSource = panelSource.slice(rowStart, rowEnd);

test("Room ID and password values are separate labeled text stops", () => {
  assert.match(panelSource, /<CredentialRow\s+label="Room ID"\s+value=\{id\}/);
  assert.match(panelSource, /<CredentialRow\s+label="Password"\s+value=\{password\}/);
  assert.match(rowSource, /<View\s+accessible\s+accessibilityRole="text"/);
  assert.match(rowSource, /accessibilityLabel=\{`\$\{label\}: \$\{value\}`\}/);
  assert.match(rowSource, /<Text accessible=\{false\} style=\{styles\.label\}>/);
  assert.match(rowSource, /<Text accessible=\{false\} style=\{styles\.value\} selectable>/);
});

test("room credentials stay hidden until the five-minute refresh supplies approved values", () => {
  const startsAtMs = Date.parse("2026-10-08T14:00:00.000Z");
  const schedule = getRoomCredentialSchedule(new Date(startsAtMs).toISOString());
  assert.ok(schedule);
  assert.equal(schedule.releaseAtMs, startsAtMs - ROOM_CREDENTIAL_REVEAL_LEAD_MS);

  const beforeRelease = {
    status: "approved",
    configured: true,
    now: schedule.releaseAtMs - 1,
    roomId: null,
    roomPassword: null,
  };
  assert.equal(beforeRelease.now < schedule.releaseAtMs, true);
  assert.equal(
    hasServerAuthorizedRoomCredentials(beforeRelease.roomId, beforeRelease.roomPassword),
    false,
    "the server response before T-5 must not contain room values",
  );

  const afterRelease = {
    status: "approved",
    configured: true,
    now: schedule.releaseAtMs + 20,
    roomId: "FAKE-ROOM-101",
    roomPassword: "FAKE-PASS-101",
  };
  assert.equal(afterRelease.now >= schedule.releaseAtMs, true);
  assert.equal(
    hasServerAuthorizedRoomCredentials(afterRelease.roomId, afterRelease.roomPassword),
    true,
    "the approved response after T-5 should provide room values",
  );

  assert.match(panelSource, /now < schedule\.releaseAtMs/);
  assert.match(panelSource, /const credentialsReady = hasServerAuthorizedRoomCredentials\(id, password\)/);
  assert.match(panelSource, /\{credentialsReady \? \(/);
  assert.match(panelSource, /label="Room ID"[\s\S]*?label="Password"/);
});

test("large text on a narrow phone stacks each full-width value above its copy button", () => {
  assert.equal(shouldStackRoomCredentialRows(1, 320), false);
  assert.equal(shouldStackRoomCredentialRows(1.49, 320), false);
  assert.equal(shouldStackRoomCredentialRows(1.5, 320), true);
  assert.equal(shouldStackRoomCredentialRows(1.8, 380), true);
  assert.equal(shouldStackRoomCredentialRows(1.5, 381), false);

  assert.match(panelSource, /useWindowDimensions/);
  assert.match(
    panelSource,
    /shouldStackRoomCredentialRows\(fontScale, width\)/,
  );
  assert.match(
    panelSource,
    /<CredentialRow[\s\S]*?label="Room ID"[\s\S]*?stackRows=\{stackCredentialRows\}/,
  );
  assert.match(
    panelSource,
    /<CredentialRow[\s\S]*?label="Password"[\s\S]*?stackRows=\{stackCredentialRows\}/,
  );
  assert.match(
    rowSource,
    /style=\{\[styles\.credentialRow, stackRows && styles\.credentialRowStacked\]\}/,
  );
  assert.match(
    rowSource,
    /style=\{\[styles\.copyButton, stackRows && styles\.copyButtonStacked\]\}/,
  );
  assert.match(panelSource, /credentialRowStacked: \{ flexDirection: 'column', alignItems: 'stretch'/);
  assert.match(panelSource, /copyButtonStacked: \{ alignSelf: 'flex-start' \}/);
  assert.match(panelSource, /copyButton: \{ minHeight: 40, maxWidth: '100%'/);
  assert.match(panelSource, /copyText: \{ flexShrink: 1/);
  assert.doesNotMatch(rowSource, /numberOfLines=/);
});

test("copy controls have distinct labels and hide their decorative child stops", () => {
  const pressableStart = rowSource.indexOf("<Pressable");
  const pressableEnd = rowSource.indexOf("</Pressable>", pressableStart);
  assert.ok(pressableStart >= 0 && pressableEnd > pressableStart);
  const buttonSource = rowSource.slice(pressableStart, pressableEnd + "</Pressable>".length);
  assert.match(buttonSource, /accessibilityRole="button"/);
  assert.match(buttonSource, /accessibilityLabel=\{`Copy \$\{label\}`\}/);
  assert.match(buttonSource, /accessibilityHint="Copies this value to your clipboard\."/);
  assert.match(buttonSource, /<Feather accessible=\{false\}/);
  assert.match(buttonSource, /<Text accessible=\{false\} style=\{styles\.copyText\}>Copy \{label\}<\/Text>/);
});

test("clipboard success and failure return clear feedback for TalkBack announcements", async () => {
  const success = await copyRoomCredentialToClipboard(
    "Room ID",
    "FAKE-ROOM-123",
    async (value) => value === "FAKE-ROOM-123",
  );
  assert.deepEqual(success, {
    kind: "success",
    message: "Room ID copied to clipboard.",
  });

  const declined = await copyRoomCredentialToClipboard("Password", "FAKE-PASS", async () => false);
  assert.deepEqual(declined, {
    kind: "failure",
    message: "Could not copy Password. Please try again.",
  });

  const rejected = await copyRoomCredentialToClipboard("Room ID", "FAKE-ROOM-123", async () => {
    throw new Error("clipboard unavailable");
  });
  assert.deepEqual(rejected, {
    kind: "failure",
    message: "Could not copy Room ID. Please try again.",
  });

  assert.match(panelSource, /AccessibilityInfo\.announceForAccessibility\(feedback\.message\)/);
  assert.match(panelSource, /testID="room-credential-copy-feedback"/);
});

test("a successful retry copies the selected value and replaces the prior failure feedback", async () => {
  let simulateClipboardFailure = true;
  let clipboardValue;
  let visibleFeedback;
  const writeClipboard = async (value) => {
    if (simulateClipboardFailure) throw new Error("Simulated clipboard failure");
    clipboardValue = value;
    return true;
  };

  visibleFeedback = await copyRoomCredentialToClipboard(
    "Room ID",
    "FAKE-ROOM-123",
    writeClipboard,
  );
  assert.deepEqual(visibleFeedback, {
    kind: "failure",
    message: "Could not copy Room ID. Please try again.",
  });

  simulateClipboardFailure = false;
  visibleFeedback = await copyRoomCredentialToClipboard(
    "Room ID",
    "FAKE-ROOM-123",
    writeClipboard,
  );

  assert.equal(clipboardValue, "FAKE-ROOM-123");
  assert.deepEqual(visibleFeedback, {
    kind: "success",
    message: "Room ID copied to clipboard.",
  });
  assert.match(
    panelSource,
    /setCopyFeedback\(feedback\);\s*AccessibilityInfo\.announceForAccessibility\(feedback\.message\);/,
  );
  assert.match(
    panelSource,
    /testID="room-credential-copy-feedback"[\s\S]*?>\s*\{copyFeedback\.message\}/,
  );
});

test("clipboard failure simulation is development-only and covers both credentials", () => {
  assert.match(
    panelSource,
    /const \[simulateClipboardFailure, setSimulateClipboardFailure\] = useState\(false\)/,
  );
  assert.match(
    panelSource,
    /const writeClipboard = __DEV__ && simulateClipboardFailure\s*\?\s*async \(\) => \{ throw new Error\('Simulated clipboard failure'\); \}/,
  );
  assert.match(
    panelSource,
    /<CredentialRow\s+label="Room ID"\s+value=\{id\}\s+onCopy=\{\(\) => copy\('Room ID', id\)\}\s+stackRows=\{stackCredentialRows\}\s+\/>/,
  );
  assert.match(
    panelSource,
    /<CredentialRow\s+label="Password"\s+value=\{password\}\s+onCopy=\{\(\) => copy\('Password', password\)\}\s+stackRows=\{stackCredentialRows\}\s+\/>/,
  );
  assert.match(
    panelSource,
    /\{__DEV__ \? \(\s*<Pressable[\s\S]*?testID="room-credential-simulate-clipboard-failure"/,
  );
  assert.match(
    panelSource,
    /setSimulateClipboardFailure\(nextValue\);[\s\S]*?nextValue\s*\?\s*'Clipboard failure simulation on\.'\s*:\s*'Clipboard failure simulation off\.'/,
  );
});

test("room details refresh in place while focused and the interval stops on blur", async () => {
  assert.equal(TOURNAMENT_DETAIL_REFRESH_INTERVAL_MS, 30_000);
  assert.match(
    detailSource,
    /useEffect\(\s*\(\) => startTournamentDetailPolling\(isFocused,\s*\(\) => \{\s*void load\(\);\s*\}\),\s*\[isFocused, load\]\s*,?\s*\)/,
  );
  assert.match(
    detailSource,
    /const canViewRoomDetails = registrationStatus === 'approved' && tournamentStatus !== 'cancelled';/,
  );
  assert.match(detailSource, /configured=\{t\.myRegistration\?\.roomPublished === true\}/);
  assert.match(detailSource, /roomId=\{t\.myRegistration\?\.roomId\}/);
  assert.match(detailSource, /roomPassword=\{t\.myRegistration\?\.roomPassword\}/);

  const snapshots = [
    {
      tournament: { id: "match-1", startsAt: "2026-10-08T12:00:00.000Z" },
      registrations: [{
        tournamentId: "match-1",
        status: "approved",
        roomPublished: false,
        roomId: null,
        roomPassword: null,
      }],
    },
    {
      tournament: { id: "match-1", startsAt: "2026-10-08T12:00:00.000Z" },
      registrations: [{
        tournamentId: "match-1",
        status: "approved",
        roomPublished: true,
        roomId: "FAKE-ROOM-101",
        roomPassword: "FAKE-PASS-101",
      }],
    },
    {
      tournament: { id: "match-1", startsAt: "2026-10-08T12:00:00.000Z" },
      registrations: [{
        tournamentId: "match-1",
        status: "approved",
        roomPublished: true,
        roomId: "FAKE-ROOM-202",
        roomPassword: "FAKE-PASS-202",
      }],
    },
  ];
  let snapshotIndex = 0;
  const apiReads = [];
  const api = {
    async tournament(id) {
      apiReads.push(["tournament", id]);
      return snapshots[snapshotIndex].tournament;
    },
    async myRegistrations() {
      apiReads.push(["my-registrations"]);
      const registrations = snapshots[snapshotIndex].registrations;
      snapshotIndex = Math.min(snapshotIndex + 1, snapshots.length - 1);
      return registrations;
    },
  };
  let visiblePanelProps;
  const refresh = async () => {
    const details = await fetchTournamentDetailSnapshot("match-1", api);
    visiblePanelProps = {
      configured: details.myRegistration?.roomPublished === true,
      roomId: details.myRegistration?.roomId,
      roomPassword: details.myRegistration?.roomPassword,
    };
  };

  await refresh();
  assert.deepEqual(visiblePanelProps, {
    configured: false,
    roomId: null,
    roomPassword: null,
  });

  const intervals = [];
  const timers = {
    setInterval(callback, delayMs) {
      const interval = { callback, delayMs, active: true };
      intervals.push(interval);
      return interval;
    },
    clearInterval(interval) {
      interval.active = false;
    },
  };
  const stopWhileBlurred = startTournamentDetailPolling(false, refresh, timers);
  assert.equal(intervals.length, 0, "a blurred screen must not create an interval");
  stopWhileBlurred();

  const stopPolling = startTournamentDetailPolling(true, refresh, timers);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delayMs, 30_000);
  await intervals[0].callback();
  assert.deepEqual(visiblePanelProps, {
    configured: true,
    roomId: "FAKE-ROOM-101",
    roomPassword: "FAKE-PASS-101",
  });
  await intervals[0].callback();
  assert.deepEqual(visiblePanelProps, {
    configured: true,
    roomId: "FAKE-ROOM-202",
    roomPassword: "FAKE-PASS-202",
  });
  assert.deepEqual(apiReads, [
    ["tournament", "match-1"],
    ["my-registrations"],
    ["tournament", "match-1"],
    ["my-registrations"],
    ["tournament", "match-1"],
    ["my-registrations"],
  ]);

  stopPolling();
  assert.equal(intervals[0].active, false, "blurring should cancel the active interval");
  const readsAfterBlur = apiReads.length;
  if (intervals[0].active) await intervals[0].callback();
  assert.equal(apiReads.length, readsAfterBlur, "the cancelled interval must not refresh after blur");
});

test("a failed detail read waits for its paired registration request to settle", async () => {
  let finishRegistrations;
  const pendingSnapshot = fetchTournamentDetailSnapshot("match-1", {
    async tournament() {
      throw new Error("Tournament read failed");
    },
    myRegistrations() {
      return new Promise((resolve) => { finishRegistrations = resolve; });
    },
  });
  let snapshotSettled = false;
  void pendingSnapshot.finally(() => { snapshotSettled = true; }).catch(() => {});

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finishRegistrations, "function");
  assert.equal(snapshotSettled, false);
  finishRegistrations([]);
  await assert.rejects(pendingSnapshot, /Tournament read failed/);
  assert.equal(snapshotSettled, true);
});
