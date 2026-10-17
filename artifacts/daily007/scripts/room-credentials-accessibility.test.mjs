import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  copyRoomCredentialToClipboard,
  createRoomCredentialCopyRequestGuard,
} from "../src/lib/roomCredentialCopy.ts";
import { shouldStackRoomCredentialRows } from "../src/lib/roomCredentialLayout.ts";
import {
  getRoomCredentialSchedule,
  hasServerAuthorizedRoomCredentials,
  ROOM_CREDENTIAL_REVEAL_LEAD_MS,
} from "../src/lib/roomCredentialTiming.ts";
import {
  createRoomCredentialAvailabilityAnnouncementTracker,
} from "../src/lib/roomCredentialAvailabilityAnnouncement.ts";
import {
  createTournamentDetailRefreshController,
  fetchTournamentDetailSnapshot,
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

test("room availability and credential replacements are announced without exposing values", () => {
  const claimAnnouncement = createRoomCredentialAvailabilityAnnouncementTracker();
  assert.equal(claimAnnouncement("match-1", false, null, null), null);
  assert.equal(
    claimAnnouncement("match-1", false, "FAKE-ROOM-999", "FAKE-PASS-999"),
    null,
    "unavailable credentials must not be observed or announced",
  );
  assert.equal(claimAnnouncement("match-1", true, null, null), null);
  assert.equal(
    claimAnnouncement("match-1", true, "FAKE-ROOM-101", "FAKE-PASS-101"),
    "available",
  );
  assert.equal(
    claimAnnouncement("match-1", true, "FAKE-ROOM-101", "FAKE-PASS-101"),
    null,
    "unchanged polling and screen re-entry must not repeat an announcement",
  );
  assert.equal(claimAnnouncement("match-1", false, null, null), null);
  assert.equal(
    claimAnnouncement("match-1", true, "FAKE-ROOM-101", "FAKE-PASS-101"),
    null,
    "temporarily unavailable credentials must not reset the last authorized values",
  );
  assert.equal(
    claimAnnouncement("match-1", true, "FAKE-ROOM-202", "FAKE-PASS-101"),
    "updated",
    "a changed Room ID must be announced once",
  );
  assert.equal(
    claimAnnouncement("match-1", true, "FAKE-ROOM-202", "FAKE-PASS-101"),
    null,
    "the same replacement must not be announced again on later polls",
  );
  assert.equal(
    claimAnnouncement("match-1", true, "FAKE-ROOM-202", "FAKE-PASS-202"),
    "updated",
    "a changed password must also be announced",
  );
  assert.equal(
    claimAnnouncement("match-2", true, "FAKE-ROOM-303", "FAKE-PASS-303"),
    "available",
    "each tournament announces its first release independently",
  );

  assert.match(
    detailSource,
    /claimRoomDetailsAvailabilityAnnouncement\(\s*tournamentId,\s*roomCredentialsAvailable,\s*roomId,\s*roomPassword,?\s*\)/,
  );
  assert.match(detailSource, /'Room details are now available\.'/);
  assert.match(detailSource, /'Room details have been updated\.'/);
  assert.match(detailSource, /\[isFocused, tournamentId, roomCredentialsAvailable, roomId, roomPassword\]/);
  assert.match(detailSource, /Platform\.OS === 'ios'.*AccessibilityInfo\.announceForAccessibility\(announcement\)/);
  assert.match(detailSource, /accessibilityLiveRegion="polite"/);
  assert.match(detailSource, /key=\{roomDetailsAnnouncementVersion\}/);
  assert.doesNotMatch(
    detailSource,
    /announcement\s*=\s*`[^`]*(?:roomId|roomPassword|Room ID|Password)/,
    "automatic announcements must never interpolate a credential",
  );
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

test("changing either room credential clears old success and failure feedback before copying new values", async () => {
  const resetEffect = panelSource.match(
    /useEffect\(\(\) => \{\s*(setCopyFeedback\(null\);)\s*\}, \[([^\]]+)\]\);/,
  );
  assert.ok(resetEffect, "credential changes must clear the previous copy feedback");
  const dependencies = resetEffect[2].split(",").map((dependency) => dependency.trim());
  assert.deepEqual(dependencies, ["credentialsReady", "id", "password"]);
  const resetFeedback = new Function("setCopyFeedback", resetEffect[1]);
  let credentials = {
    credentialsReady: true,
    id: "FAKE-ROOM-101",
    password: "FAKE-PASS-101",
  };
  let visibleFeedback = {
    kind: "success",
    message: "Room ID copied to clipboard.",
  };

  const updateCredentials = (nextCredentials) => {
    const changed = dependencies.some(
      (dependency) => credentials[dependency] !== nextCredentials[dependency],
    );
    credentials = nextCredentials;
    if (changed) resetFeedback((nextFeedback) => { visibleFeedback = nextFeedback; });
  };

  updateCredentials({ ...credentials, id: "FAKE-ROOM-202" });
  assert.equal(visibleFeedback, null, "a previous success must disappear when the room ID changes");
  assert.equal(credentials.id, "FAKE-ROOM-202", "the new room ID is available after feedback clears");

  visibleFeedback = {
    kind: "failure",
    message: "Could not copy Password. Please try again.",
  };
  updateCredentials({ ...credentials, password: "FAKE-PASS-202" });
  assert.equal(visibleFeedback, null, "a previous failure must disappear when the password changes");
  assert.equal(credentials.password, "FAKE-PASS-202", "the new password is available after feedback clears");

  const clipboardValues = [];
  const newCopyFeedback = await copyRoomCredentialToClipboard(
    "Password",
    credentials.password,
    async (value) => {
      clipboardValues.push(value);
      return true;
    },
  );
  assert.deepEqual(clipboardValues, ["FAKE-PASS-202"]);
  assert.deepEqual(newCopyFeedback, {
    kind: "success",
    message: "Password copied to clipboard.",
  });
  assert.match(panelSource, /AccessibilityInfo\.announceForAccessibility\(feedback\.message\)/);
  assert.match(panelSource, /testID="room-credential-copy-feedback"/);
});

test("only the most recently tapped credential updates or announces copy feedback", async () => {
  const createDeferred = () => {
    let resolve;
    const promise = new Promise((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  };
  const roomIdWrite = createDeferred();
  const passwordWrite = createDeferred();
  const requestGuard = createRoomCredentialCopyRequestGuard();
  const clipboardAttempts = [];
  const announcements = [];
  let visibleFeedback;
  const runCopy = async (label, value, writePromise) => {
    const requestId = requestGuard.beginRequest();
    clipboardAttempts.push(value);
    const feedback = await copyRoomCredentialToClipboard(
      label,
      value,
      () => writePromise,
    );
    if (!requestGuard.isCurrentRequest(requestId)) return;
    visibleFeedback = feedback;
    announcements.push(feedback.message);
  };

  const roomIdRequest = runCopy("Room ID", "FAKE-ROOM-123", roomIdWrite.promise);
  const passwordRequest = runCopy("Password", "FAKE-PASS-456", passwordWrite.promise);

  passwordWrite.resolve(true);
  await passwordRequest;
  assert.deepEqual(visibleFeedback, {
    kind: "success",
    message: "Password copied to clipboard.",
  });
  assert.deepEqual(announcements, ["Password copied to clipboard."]);

  roomIdWrite.resolve(true);
  await roomIdRequest;
  assert.deepEqual(visibleFeedback, {
    kind: "success",
    message: "Password copied to clipboard.",
  });
  assert.deepEqual(announcements, ["Password copied to clipboard."]);
  assert.deepEqual(clipboardAttempts, ["FAKE-ROOM-123", "FAKE-PASS-456"]);

  const failureGuard = createRoomCredentialCopyRequestGuard();
  const olderSuccess = createDeferred();
  const latestFailure = createDeferred();
  const failureAnnouncements = [];
  let latestVisibleFeedback;
  const runFailureScenario = async (requestGuard, announcementsForScenario, setVisible, label, value, writePromise) => {
    const requestId = requestGuard.beginRequest();
    const feedback = await copyRoomCredentialToClipboard(label, value, () => writePromise);
    if (!requestGuard.isCurrentRequest(requestId)) return;
    setVisible(feedback);
    announcementsForScenario.push(feedback.message);
  };
  const olderSuccessRequest = runFailureScenario(
    failureGuard,
    failureAnnouncements,
    (feedback) => { latestVisibleFeedback = feedback; },
    "Room ID",
    "FAKE-ROOM-123",
    olderSuccess.promise,
  );
  const latestFailureRequest = runFailureScenario(
    failureGuard,
    failureAnnouncements,
    (feedback) => { latestVisibleFeedback = feedback; },
    "Password",
    "FAKE-PASS-456",
    latestFailure.promise,
  );
  latestFailure.resolve(false);
  await latestFailureRequest;
  olderSuccess.resolve(true);
  await olderSuccessRequest;
  assert.deepEqual(latestVisibleFeedback, {
    kind: "failure",
    message: "Could not copy Password. Please try again.",
  });
  assert.deepEqual(failureAnnouncements, ["Could not copy Password. Please try again."]);

  assert.match(
    panelSource,
    /const requestId = copyRequestGuard\.current\.beginRequest\(\);[\s\S]*?await copyRoomCredentialToClipboard\([\s\S]*?if \(!copyRequestGuard\.current\.isCurrentRequest\(requestId\)\) return;[\s\S]*?setCopyFeedback\(feedback\);[\s\S]*?AccessibilityInfo\.announceForAccessibility\(feedback\.message\);/,
  );
});

test("leaving tournament details suppresses a late clipboard result, while focused copies still report", async () => {
  const createDeferred = () => {
    let resolve;
    const promise = new Promise((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  };

  const requestGuard = createRoomCredentialCopyRequestGuard();
  const delayedWrite = createDeferred();
  const announcements = [];
  let visibleFeedback = null;
  const runCopy = async (writePromise) => {
    const requestId = requestGuard.beginRequest();
    const feedback = await copyRoomCredentialToClipboard(
      "Room ID",
      "FAKE-ROOM-123",
      () => writePromise,
    );
    if (!requestGuard.isCurrentRequest(requestId)) return;
    visibleFeedback = feedback;
    announcements.push(feedback.message);
  };

  const pendingCopy = runCopy(delayedWrite.promise);
  requestGuard.invalidateRequests();
  delayedWrite.resolve(true);
  await pendingCopy;

  assert.equal(visibleFeedback, null, "a late result must not update the departed panel");
  assert.deepEqual(announcements, [], "a late result must not announce after navigation");

  const focusedWrite = createDeferred();
  const focusedCopy = runCopy(focusedWrite.promise);
  focusedWrite.resolve(true);
  await focusedCopy;
  assert.deepEqual(visibleFeedback, {
    kind: "success",
    message: "Room ID copied to clipboard.",
  });
  assert.deepEqual(announcements, ["Room ID copied to clipboard."]);

  assert.match(
    panelSource,
    /useFocusEffect\(\s*useCallback\(\(\) => \{\s*return \(\) => \{\s*copyRequestGuard\.current\.invalidateRequests\(\);\s*\};\s*\}, \[\]\)\s*,?\s*\)/,
    "navigation blur and unmount must invalidate pending clipboard results",
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

test("match detail polling follows both focus and app activity without duplicate resume refreshes", async () => {
  assert.equal(TOURNAMENT_DETAIL_REFRESH_INTERVAL_MS, 30_000);
  assert.match(
    detailSource,
    /AppState\.addEventListener\('change', \(nextState\) => \{\s*setIsAppActive\(nextState === 'active'\);/,
  );
  assert.match(
    detailSource,
    /detailRefreshController\.current\?\.update\(isFocused, isAppActive,/,
  );
  assert.match(
    detailSource,
    /getTournamentResultsRefreshInterval\(isFocused && isAppActive\)/,
  );
  assert.match(
    detailSource,
    /if \(!isFocused \|\| !isAppActive\) return undefined;/,
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
  snapshotIndex = 0;
  apiReads.length = 0;

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
  const controller = createTournamentDetailRefreshController(timers);
  let refreshCalls = 0;
  let pendingRefresh;
  const trackedRefresh = () => {
    refreshCalls += 1;
    pendingRefresh = refresh();
    return pendingRefresh;
  };

  // Route focus may arrive while the app is still inactive; only resume refreshes.
  controller.update(true, false, trackedRefresh);
  assert.equal(refreshCalls, 0);
  assert.equal(intervals.length, 0, "backgrounded focused screens must not poll");
  controller.update(true, true, trackedRefresh);
  await pendingRefresh;
  assert.equal(refreshCalls, 1, "returning active while focused triggers one refresh");
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

  controller.update(true, true, trackedRefresh);
  assert.equal(refreshCalls, 3, "a repeated active/focused state must not refresh again");

  // Backgrounding must cancel polling even when navigation focus remains.
  controller.update(true, false, trackedRefresh);
  assert.equal(intervals[0].active, false, "backgrounding cancels the active interval");
  const readsAfterBlur = apiReads.length;
  await intervals[0].callback();
  assert.equal(apiReads.length, readsAfterBlur, "a cleared timer must not refresh in background");
  assert.equal(refreshCalls, 3);

  controller.update(true, true, trackedRefresh);
  await pendingRefresh;
  assert.equal(refreshCalls, 4, "resuming focused route refreshes exactly once");
  assert.equal(intervals.length, 2);
  controller.update(false, true, trackedRefresh);
  assert.equal(intervals[1].active, false, "blurring cancels the active interval");
  controller.stop();
});

test("malformed and rejected registration snapshots preserve the last confirmed joined detail until valid data arrives", async () => {
  const snapshots = [
    {
      tournament: { id: "match-1", name: "Confirmed tournament" },
      registrations: [{ tournamentId: "match-1", status: "approved" }],
    },
    {
      tournament: { id: "match-1", name: "Uncommitted tournament update" },
      registrations: { malformed: true },
    },
    {
      tournament: { id: "match-1", name: "Rejected tournament update" },
      registrations: new Error("Temporary network failure"),
    },
    {
      tournament: { id: "match-1", name: "Updated tournament" },
      registrations: [],
    },
  ];
  let snapshotIndex = 0;
  let activeSnapshot = snapshots[snapshotIndex];
  const api = {
    async tournament() {
      return activeSnapshot.tournament;
    },
    async myRegistrations() {
      const registrations = activeSnapshot.registrations;
      snapshotIndex = Math.min(snapshotIndex + 1, snapshots.length - 1);
      activeSnapshot = snapshots[snapshotIndex];
      if (registrations instanceof Error) throw registrations;
      return registrations;
    },
  };
  let visibleDetail = null;
  let visibleError = "";
  const refreshDetail = async () => {
    try {
      visibleDetail = await fetchTournamentDetailSnapshot("match-1", api);
      visibleError = "";
    } catch (error) {
      visibleError = error instanceof Error ? error.message : String(error);
    }
  };

  await refreshDetail();
  assert.equal(visibleDetail.registrationStatusKnown, true);
  assert.equal(visibleDetail.joined, true);
  assert.equal(visibleDetail.name, "Confirmed tournament");

  await refreshDetail();
  assert.equal(
    visibleError,
    "Could not verify your entry status. Your last confirmed status is shown. Pull to refresh to try again.",
  );
  assert.equal(visibleDetail.registrationStatusKnown, true);
  assert.equal(visibleDetail.joined, true, "malformed data must not turn the confirmed joined state into unjoined");
  assert.equal(visibleDetail.name, "Confirmed tournament", "the malformed snapshot must not replace the visible detail");

  await refreshDetail();
  assert.equal(
    visibleError,
    "Could not verify your entry status. Your last confirmed status is shown. Pull to refresh to try again.",
  );
  assert.equal(visibleDetail.registrationStatusKnown, true);
  assert.equal(visibleDetail.joined, true, "a rejected request must not turn the confirmed joined state into unjoined");
  assert.equal(visibleDetail.name, "Confirmed tournament", "the rejected snapshot must not replace the visible detail");

  await refreshDetail();
  assert.equal(visibleError, "");
  assert.equal(visibleDetail.registrationStatusKnown, true);
  assert.equal(visibleDetail.joined, false, "a later valid empty response confirms that the player is no longer joined");
  assert.equal(visibleDetail.name, "Updated tournament");

  assert.match(
    detailSource,
    /const tournamentDetails = await fetchTournamentDetailSnapshot\(String\(id\), api\);\s*setT\(tournamentDetails\);/,
    "TDetail must only replace its displayed snapshot after the helper resolves.",
  );
  assert.match(detailSource, /catch \(e: any\) \{\s*setErr\(e\?\.message \|\| 'Failed to load'\);\s*\}/);
  assert.match(detailSource, /const joined = registrationStatusKnown && Boolean\(t\.joined\);/);
  assert.match(detailSource, /<Msg kind="err" text=\{err\} \/>/);
});

test("route focus after app resume triggers exactly one match detail refresh", () => {
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
  const controller = createTournamentDetailRefreshController(timers);
  let refreshCalls = 0;
  const refresh = () => { refreshCalls += 1; };

  // App resume can arrive first while another route is still current.
  controller.update(false, true, refresh);
  assert.equal(refreshCalls, 0);
  controller.update(true, true, refresh);
  assert.equal(refreshCalls, 1);
  controller.update(true, true, refresh);
  assert.equal(refreshCalls, 1, "the combined active/focused state must not duplicate refresh");
  assert.equal(intervals.length, 1);
  controller.stop();
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
