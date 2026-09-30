import assert from "node:assert/strict";
import test from "node:test";
import { csvCell, parseFutureTimestamp, parseTeamMembers } from "../src/lib/daily007-v2-validation.ts";

test("registration timestamps must be ISO timestamps strictly in the future", () => {
  const now = Date.parse("2030-01-01T00:00:00Z");
  assert.equal(parseFutureTimestamp("2030-01-01T00:00:00Z", now), null);
  assert.equal(parseFutureTimestamp("2029-12-31T23:59:59Z", now), null);
  assert.equal(parseFutureTimestamp("2030-01-01", now), null);
  assert.equal(parseFutureTimestamp("2030-02-30T00:00:01Z", now), null);
  assert.equal(parseFutureTimestamp("2030-01-01T00:00:01Z", now)?.toISOString(), "2030-01-01T00:00:01.000Z");
});

test("team roster requires exactly three names while game UIDs are optional", () => {
  assert.deepEqual(parseTeamMembers([
    { name: " A " },
    { name: "B", uid: "" },
    { name: "C", uid: "player-3" },
  ]), [
    { name: "A", uid: null },
    { name: "B", uid: null },
    { name: "C", uid: "player-3" },
  ]);
  assert.equal(parseTeamMembers([{ uid: "missing-name" }, { name: "B" }, { name: "C" }]), null);
  assert.equal(parseTeamMembers([{ name: "A" }, { name: "B" }]), null);
});

test("CSV cells escape quotes and neutralize spreadsheet formulas", () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("=SUM(A1:A2)"), "\"'=SUM(A1:A2)\"");
  assert.equal(csvCell("  @SUM(A1:A2)"), "\"'  @SUM(A1:A2)\"");
  assert.equal(csvCell("\uFEFF+SUM(A1:A2)"), "\"'\uFEFF+SUM(A1:A2)\"");
  assert.equal(csvCell("safe"), '"safe"');
});