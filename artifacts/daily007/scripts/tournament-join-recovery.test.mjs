import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { joinWithCapacityRefresh } from "../src/lib/tournamentJoinRecovery.ts";

const appSource = await readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);

const fullMatchErrors = [
  {
    code: "MATCH_FULL",
    message: "This match is already full and is not accepting registrations.",
  },
  {
    code: "MATCH_FULL",
    message: "Registration failed because all tournament places are now taken.",
  },
];

for (const { code, message } of fullMatchErrors) {
  test(`a full-match code refreshes capacity and preserves the server message (${message})`, async () => {
    const joinError = Object.assign(new Error(message), {
      response: { status: 409, data: { code, error: message } },
    });
    const refreshedTournament = {
      id: "match-1",
      status: "full",
      filledSlots: 12,
      availableSlots: 0,
    };
    const fetchedIds = [];
    let visibleTournament = null;

    await assert.rejects(
      joinWithCapacityRefresh(
        async () => { throw joinError; },
        "match-1",
        async (id) => {
          fetchedIds.push(id);
          return refreshedTournament;
        },
        (tournament) => { visibleTournament = tournament; },
      ),
      (error) => error === joinError,
    );

    assert.deepEqual(fetchedIds, ["match-1"]);
    assert.equal(visibleTournament, refreshedTournament);
    assert.equal(visibleTournament.availableSlots, 0);
    assert.equal(joinError.response.data.error, message);
  });
}

for (const [status, message, code] of [
  [400, "Captain Free Fire UID is required.", "INVALID_REGISTRATION"],
  [409, "Insufficient wallet balance.", "INSUFFICIENT_WALLET_BALANCE"],
  [409, "This match is full.", undefined],
]) {
  test(`an unrelated join error remains visible without a tournament refresh (${status})`, async () => {
    const joinError = Object.assign(new Error(message), {
      response: { status, data: { ...(code ? { code } : {}), error: message } },
    });
    const fetchedIds = [];
    let visibleTournament = null;

    await assert.rejects(
      joinWithCapacityRefresh(
        async () => { throw joinError; },
        "match-1",
        async (id) => {
          fetchedIds.push(id);
          return { id, status: "open" };
        },
        (tournament) => { visibleTournament = tournament; },
      ),
      (error) => error === joinError,
    );

    assert.deepEqual(fetchedIds, []);
    assert.equal(visibleTournament, null);
  });
}

test("the wallet refresh remains after a successful and validated join response", () => {
  const joinStart = appSource.indexOf("const result = await joinWithCapacityRefresh(");
  const walletRefresh = appSource.indexOf("await refresh();", joinStart);
  assert.ok(joinStart >= 0, "the join result should use capacity recovery");
  assert.ok(walletRefresh > joinStart, "wallet data refresh should follow the join request");

  const resultValidation = appSource.slice(joinStart, walletRefresh);
  assert.match(resultValidation, /if \(result\?\.success === false \|\| result\?\.ok === false\)/);
  assert.match(
    resultValidation,
    /if \(result\?\.status !== 'approved' && result\?\.status !== 'pending'\)/,
  );
  assert.doesNotMatch(resultValidation, /\bcatch\s*\(|\bfinally\s*\{/);
});

test("a failed capacity refresh preserves the original server rejection", async () => {
  const message = "Capacity has been reached.";
  const joinError = Object.assign(new Error(message), {
    response: { status: 409, data: { code: "MATCH_FULL", error: message } },
  });
  const refreshError = new Error("Tournament refresh failed");
  let visibleTournament = {
    id: "match-1",
    status: "open",
    totalSlots: 12,
    totalPlayerSlots: 48,
    filledSlots: 11,
    filledPlayerSlots: 44,
    availableSlots: 1,
  };

  await assert.rejects(
    joinWithCapacityRefresh(
      async () => { throw joinError; },
      "match-1",
      async () => { throw refreshError; },
      (next) => {
        visibleTournament = typeof next === "function"
          ? next(visibleTournament)
          : next;
      },
    ),
    (error) => error === joinError,
  );
  assert.deepEqual(visibleTournament, {
    id: "match-1",
    status: "full",
    totalSlots: 12,
    totalPlayerSlots: 48,
    filledSlots: 12,
    filledPlayerSlots: 48,
    availableSlots: 0,
  });
});