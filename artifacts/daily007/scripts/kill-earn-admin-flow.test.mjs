import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const route = readFileSync(new URL("app/kill-earn-admin-flow-test.tsx", root), "utf8");
const fixture = readFileSync(
  new URL("src/screens/KillEarnAdminFlowNativeTest.tsx", root),
  "utf8",
);
const flow = readFileSync(
  new URL("maestro/kill-earn-admin-flow/create-edit-formats.yaml", root),
  "utf8",
);

test("the Android fixture is unreachable in production builds", () => {
  assert.match(route, /if \(!__DEV__\) return <Redirect href="\/" \/>;/);
  assert.match(fixture, /if \(!__DEV__\) return <Redirect href="\/" \/>;/);
});

test("tournament changes stay in memory and unrecognized API requests are blocked", () => {
  assert.match(fixture, /Api\.createTournament = async/);
  assert.match(fixture, /Api\.updateTournament = async/);
  assert.match(fixture, /Api\.tournaments = async \(\) => tournamentsRef\.current/);
  assert.match(fixture, /Api\.myRegistrations = async \(\) => \[\]/);
  assert.match(fixture, /pathname\.startsWith\('\/api\/'\)[\s\S]*?responseFor\([\s\S]*?\}, 403\)/);
  assert.match(fixture, /Api\.createTournament = originalApi\.createTournament/);
  assert.match(fixture, /Api\.updateTournament = originalApi\.updateTournament/);
  assert.match(fixture, /globalThis as any\)\.fetch = originalFetch\.current/);
  assert.doesNotMatch(fixture, /Api\.(?:deleteTournament|adminSaveRoom|adminPublishRoom|publishResult)\s*=/);
});

test("the Maestro flow creates, edits, and verifies every Kill & Earn format", () => {
  for (const format of ["solo", "duo", "squad"]) {
    const title = format[0].toUpperCase() + format.slice(1);
    assert.match(flow, new RegExp(`Created ${title} · 5 coins per kill`));
    assert.match(flow, new RegExp(`Updated ${title} · [678] coins per kill`));
    assert.match(flow, new RegExp(`format-live-count-battle_royale_kill_earn-${format}`));
    assert.match(flow, new RegExp(`Battle Royale Kill & Earn ${title}`));
    assert.match(flow, new RegExp(`edit-tournament-kill-earn-${format}`));
  }
});
