import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  takeTournamentStartAnnouncement,
  takeTournamentStartAnnouncements,
} from "../src/lib/tournamentStartAnnouncement.ts";

const [playerScreenSource, adminScreenSource] = await Promise.all([
  readFile(new URL("../src/screens/Tournaments.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/screens/AdminTournaments.tsx", import.meta.url), "utf8"),
]);

test("each staggered tournament start has one concise announcement", () => {
  const announcedTournamentIds = new Set();

  assert.equal(
    takeTournamentStartAnnouncement(
      { id: "first", name: "IST Month-End Boundary" },
      announcedTournamentIds,
    ),
    "Tournament IST Month-End Boundary is now ongoing.",
  );
  assert.equal(
    takeTournamentStartAnnouncement(
      { id: "later", name: "Later Month-End Start" },
      announcedTournamentIds,
    ),
    "Tournament Later Month-End Start is now ongoing.",
  );

  assert.equal(
    takeTournamentStartAnnouncement(
      { id: "first", name: "IST Month-End Boundary" },
      announcedTournamentIds,
    ),
    null,
    "Refreshes and resume events must not repeat an already announced start.",
  );
  assert.equal(
    takeTournamentStartAnnouncement(
      { id: "later", name: "Later Month-End Start" },
      announcedTournamentIds,
    ),
    null,
  );
});

test("simultaneous tournament starts announce each tournament once", () => {
  const announcedTournamentIds = new Set();
  const announcements = [
    takeTournamentStartAnnouncement(
      { id: "same-time-first", name: "Same-Time First Match" },
      announcedTournamentIds,
    ),
    takeTournamentStartAnnouncement(
      { id: "same-time-second", name: "Same-Time Second Match" },
      announcedTournamentIds,
    ),
  ].filter(Boolean);

  assert.deepEqual(announcements, [
    "Tournament Same-Time First Match is now ongoing.",
    "Tournament Same-Time Second Match is now ongoing.",
  ]);
  assert.equal(
    announcements.join(" "),
    "Tournament Same-Time First Match is now ongoing. Tournament Same-Time Second Match is now ongoing.",
    "Android must be able to expose both starts in one polite live-region update.",
  );
  assert.equal(
    takeTournamentStartAnnouncement(
      { id: "same-time-first", name: "Same-Time First Match" },
      announcedTournamentIds,
    ),
    null,
    "A refresh must not repeat a tournament already announced in the same-time batch.",
  );
});

test("inactive-list starts are caught on return and remain one-time", () => {
  const announcedTournamentIds = new Set();
  const tournaments = [
    { id: "missed", name: "Missed While Away", lifecycle: "ongoing" },
    { id: "already-heard", name: "Already Heard", lifecycle: "ongoing" },
    { id: "not-started", name: "Still Upcoming", lifecycle: "upcoming" },
  ];
  announcedTournamentIds.add("already-heard");

  assert.deepEqual(
    takeTournamentStartAnnouncements(
      tournaments,
      (tournament) => tournament.lifecycle === "ongoing",
      announcedTournamentIds,
    ),
    ["Tournament Missed While Away is now ongoing."],
  );
  assert.deepEqual(
    takeTournamentStartAnnouncements(
      tournaments,
      (tournament) => tournament.lifecycle === "ongoing",
      announcedTournamentIds,
    ),
    [],
    "Returning again must not repeat a missed or previously heard start.",
  );
});

test("Player and Admin announce a tournament first returned by refresh only once at its start", () => {
  const startMs = Date.parse("2026-10-18T12:00:00.000Z");
  const refreshedTournament = {
    id: "first-returned-by-refresh",
    name: "Newly Refreshed Match",
    startsAt: new Date(startMs).toISOString(),
    lifecycle: "upcoming",
  };

  for (const [screenName, source, listName, upcomingPredicate] of [
    [
      "Player",
      playerScreenSource,
      "items",
      /lifecycleOf\(tournament\) === 'upcoming'[\s\S]*?getRoomCredentialSchedule\(tournament\.startsAt\)\?\.startsAtMs === nextTransition/,
    ],
    [
      "Admin",
      adminScreenSource,
      "list",
      /getTournamentLifecycleState\(tournament, clockNow\) === 'upcoming'[\s\S]*?Date\.parse\(String\(tournament\.startsAt \?\? ''\)\) === nextStart\.startMs/,
    ],
  ]) {
    const announcedTournamentIds = new Set();
    let loadedTournaments = [];

    assert.match(
      source,
      listName === "items"
        ? /const transitions = items\.flatMap[\s\S]*?takeTournamentStartAnnouncements\(\s*items,[\s\S]*?\}, \[items, clockNow, load\]\);/
        : /const nextStart = list[\s\S]*?takeTournamentStartAnnouncements\(\s*list,[\s\S]*?\}, \[list, clockNow, load\]\);/,
      `${screenName} must recalculate its start timer and callback when refreshed list data changes.`,
    );
    assert.match(
      source,
      upcomingPredicate,
      `${screenName} must announce only the refreshed upcoming tournament whose start timer fired.`,
    );

    // This tournament was absent before the successful refresh that populated this list.
    loadedTournaments = [refreshedTournament];
    const announceAtStart = () =>
      takeTournamentStartAnnouncements(
        loadedTournaments,
        (tournament) =>
          tournament.lifecycle === "upcoming" &&
          Date.parse(tournament.startsAt) === startMs,
        announcedTournamentIds,
      );

    assert.deepEqual(announceAtStart(), [
      "Tournament Newly Refreshed Match is now ongoing.",
    ]);

    // A later refresh returns the same tournament again, but its start is already claimed.
    loadedTournaments = [{ ...refreshedTournament }];
    assert.deepEqual(
      announceAtStart(),
      [],
      `${screenName} refreshes must not repeat a scheduled start announcement.`,
    );
  }
});

test("Player and Admin lists expose queued VoiceOver and polite live-region announcements", () => {
  for (const [screenName, source] of [
    ["Player", playerScreenSource],
    ["Admin", adminScreenSource],
  ]) {
    assert.match(
      source,
      /Platform\.OS === 'ios'[\s\S]*?AccessibilityInfo\.announceForAccessibilityWithOptions\(announcement, \{\s*queue: true,\s*priority: 'low',\s*\}\)/,
      `${screenName} starts must be queued for VoiceOver without interrupting current speech.`,
    );
    assert.match(
      source,
      /accessibilityLiveRegion="polite"/,
      `${screenName} starts must be exposed to TalkBack through a polite live region.`,
    );
  }
});

test("Player and Admin check for missed starts only after an inactive period and successful list load", () => {
  for (const [screenName, source, listName] of [
    ["Player", playerScreenSource, "items"],
    ["Admin", adminScreenSource, "list"],
  ]) {
    assert.match(
      source,
      /missedStartCheckPending\.current = true/,
      `${screenName} must remember when the list becomes inactive.`,
    );
    assert.match(
      source,
      /if \(missedStartCheckPending\.current\) \{\s*setMissedStartCheckVersion/,
      `${screenName} must trigger the missed-start check only after a successful refresh.`,
    );
    assert.match(
      source,
      listName === "items"
        ? /takeTournamentStartAnnouncements\(\s*items,\s*\(tournament\) => lifecycleOf\(tournament\) === 'ongoing'/
        : /takeTournamentStartAnnouncements\(\s*list,\s*\(tournament\) => getTournamentLifecycleState\(tournament, clockNow\) === 'ongoing'/,
      `${screenName} must announce only tournaments that are ongoing when the list returns.`,
    );
  }
});

test("Player first-load failure and recovery queue VoiceOver announcements once on iOS", () => {
  assert.match(
    playerScreenSource,
    /function announcePlayerLoadStatusOnIOS\(message: string\): void \{\s*if \(Platform\.OS !== 'ios'\) return;\s*AccessibilityInfo\.announceForAccessibilityWithOptions\(message, \{\s*queue: true,\s*priority: 'low',\s*\}\);\s*\}/,
    "Player load-status speech must be queued for VoiceOver only, leaving TalkBack to the live regions.",
  );
  assert.match(
    playerScreenSource,
    /const announcedInitialLoadFailure = useRef\(false\);[\s\S]*const announcedInitialLoadRecovery = useRef\(false\);/,
    "Player first-load error and recovery announcements need independent one-time guards.",
  );
  assert.match(
    playerScreenSource,
    /announcedInitialLoadFailure\.current = true;\s*announcePlayerLoadStatusOnIOS\(`Could not load tournaments: \$\{error\}`\);/,
    "The first tournament-load failure must announce its visible error once on iOS.",
  );
  assert.match(
    playerScreenSource,
    /announcedInitialLoadRecovery\.current = true;\s*announcePlayerLoadStatusOnIOS\(playerLoadAnnouncement\);/,
    "The first successful recovery must announce the loaded status once on iOS.",
  );
  assert.match(
    playerScreenSource,
    /accessibilityLiveRegion="polite"/,
    "The Android TalkBack live-region path must remain available.",
  );
});
