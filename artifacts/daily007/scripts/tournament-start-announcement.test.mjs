import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { takeTournamentStartAnnouncement } from "../src/lib/tournamentStartAnnouncement.ts";

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
