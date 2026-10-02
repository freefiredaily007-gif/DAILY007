import assert from "node:assert/strict";
import test from "node:test";
import { csvCell, parseFutureTimestamp, parseTeamMembers } from "../src/lib/daily007-v2-validation.ts";
import { resolveTournamentMode } from "../src/lib/daily007-mode-rules.ts";
import { createDaily007ReferralLinks } from "../src/lib/daily007-referral-links.ts";

test("registration timestamps must be ISO timestamps strictly in the future", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  assert.equal(parseFutureTimestamp("2030-01-01T00:00:00Z", now), null);
  assert.equal(parseFutureTimestamp("2029-12-31T23:59:59Z", now), null);
  assert.equal(parseFutureTimestamp("2030-01-01", now), null);
  assert.equal(parseFutureTimestamp("2030-02-30T00:00:01Z", now), null);
  assert.equal(parseFutureTimestamp("2030-01-01T00:00:01Z", now)?.toISOString(), "2030-01-01T00:00:01.000Z");
});

test("team roster size follows the selected format while game UIDs remain optional", () => {
  assert.deepEqual(parseTeamMembers([
    { name: " A " },
    { name: "B", uid: "" },
    { name: "C", uid: "player-3" },
  ]), [
    { name: "A", uid: null },
    { name: "B", uid: null },
    { name: "C", uid: "player-3" },
  ]);
  assert.deepEqual(parseTeamMembers([{ name: "Duo partner" }], 1), [{ name: "Duo partner", uid: null }]);
  assert.deepEqual(parseTeamMembers([], 0), []);
  assert.equal(parseTeamMembers([{ uid: "missing-name" }, { name: "B" }, { name: "C" }]), null);
  assert.equal(parseTeamMembers([{ name: "A" }, { name: "B" }]), null);
  assert.equal(parseTeamMembers([{ name: "A", uid: "UID" }, { name: "B", uid: "uid" }]), null);
});

test("all main modes expose their fixed Solo, Duo, and Squad capacities", () => {
  const expected = [
    ["battle_royale", "solo", 48, 1, "player"],
    ["battle_royale", "duo", 24, 2, "team"],
    ["battle_royale", "squad", 12, 4, "team"],
    ["clash_squad", "solo", 2, 1, "team"],
    ["clash_squad", "duo", 2, 2, "team"],
    ["clash_squad", "squad", 2, 4, "team"],
    ["lone_wolf", "solo", 2, 1, "team"],
    ["lone_wolf", "duo", 2, 2, "team"],
    ["lone_wolf", "squad", 2, 4, "team"],
  ] as const;
  for (const [gameMode, teamType, capacity, teamSize, slotUnit] of expected) {
    const resolved = resolveTournamentMode(gameMode, teamType);
    assert.ok(resolved, `${gameMode} ${teamType} should resolve`);
    assert.equal(resolved.capacity, capacity);
    assert.equal(resolved.teamSize, teamSize);
    assert.equal(resolved.slotUnit, slotUnit);
  }
});

test("referral links are clickable HTTPS URLs with the code in the query", () => {
  process.env.DAILY007_PUBLIC_APP_URL = "https://daily007.example.test";
  const links = createDaily007ReferralLinks("DAILY 7");
  const parsedLink = new URL(links.referralLink);
  assert.equal(parsedLink.origin, "https://daily007.example.test");
  assert.equal(parsedLink.pathname, "/");
  assert.equal(parsedLink.searchParams.get("ref"), "DAILY 7");
});

test("CSV cells escape quotes and neutralize spreadsheet formulas", () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("=SUM(A1:A2)"), "\"'=SUM(A1:A2)\"");
  assert.equal(csvCell("  @SUM(A1:A2)"), "\"'  @SUM(A1:A2)\"");
  assert.equal(csvCell("\uFEFF+SUM(A1:A2)"), "\"'\uFEFF+SUM(A1:A2)\"");
  assert.equal(csvCell("safe"), '"safe"');
});