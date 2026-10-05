import assert from "node:assert/strict";
import test from "node:test";
import { joinWithCapacityRefresh } from "../src/lib/tournamentJoinRecovery.ts";

const fullMatchMessages = [
  "This match is already full and is not accepting registrations.",
  "This match is full.",
];

for (const message of fullMatchMessages) {
  test(`a full-match rejection refreshes tournament capacity and stays visible (${message})`, async () => {
    const joinError = Object.assign(new Error(message), {
      response: { status: 409, data: { error: message } },
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
  });
}

for (const [status, message] of [
  [400, "Captain Free Fire UID is required."],
  [409, "Insufficient wallet balance."],
]) {
  test(`an unrelated join error remains visible without a tournament refresh (${status})`, async () => {
    const joinError = Object.assign(new Error(message), {
      response: { status, data: { error: message } },
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

test("a failed capacity refresh preserves the original server rejection", async () => {
  const joinError = Object.assign(new Error(fullMatchMessages[1]), {
    response: { status: 409, data: { error: fullMatchMessages[1] } },
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