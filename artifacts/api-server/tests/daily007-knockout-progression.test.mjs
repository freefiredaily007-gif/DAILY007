import assert from "node:assert/strict";
import test from "node:test";
import { assessKnockoutProgression } from "../src/lib/daily007-knockout-results.ts";

const config = { squadCount: 12, round1Eliminated: 2, round2Eliminated: 2 };

function resultsFor(teamNumbers, status = "published", placementOffset = 0) {
  return teamNumbers.map((teamNumber, index) => {
    const placement = index + 1 + placementOffset;
    const placementPoints = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0][placement - 1] ?? 0;
    const squadKills = 0;
    return {
      teamNumber,
      placement,
      placementPoints,
      squadKills,
      pointsPerKill: 1,
      roundPoints: placementPoints + squadKills,
      status,
    };
  });
}

test("published results advance the exact 12 → 10 → 8 → final top-three path", () => {
  const round1Teams = Array.from({ length: 12 }, (_, index) => index + 1);
  const round1 = assessKnockoutProgression("round_1", config, round1Teams, resultsFor(round1Teams));
  assert.equal(round1.canConfirm, true);
  assert.deepEqual(
    round1.rankedResults.filter((row) => row.status === "qualified").map((row) => row.teamNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.deepEqual(
    round1.rankedResults.filter((row) => row.status === "eliminated").map((row) => row.teamNumber),
    [11, 12],
  );

  const round2Teams = round1.rankedResults.filter((row) => row.status === "qualified").map((row) => row.teamNumber);
  const round2 = assessKnockoutProgression("round_2", config, round2Teams, resultsFor(round2Teams));
  assert.equal(round2.expectedSquads, 10);
  assert.equal(round2.rankedResults.filter((row) => row.status === "qualified").length, 8);
  assert.equal(round2.rankedResults.filter((row) => row.status === "eliminated").length, 2);

  const finalTeams = round2.rankedResults.filter((row) => row.status === "qualified").map((row) => row.teamNumber);
  const final = assessKnockoutProgression("final", config, finalTeams, resultsFor(finalTeams));
  assert.equal(final.expectedSquads, 8);
  assert.equal(final.rankedResults.filter((row) => row.status === "winner").length, 3);
  assert.equal(final.rankedResults.filter((row) => row.status === "finalist").length, 5);
});

test("draft or missing results block advancement", () => {
  const teams = Array.from({ length: 12 }, (_, index) => index + 1);
  const draftResults = resultsFor(teams, "draft");
  const draftState = assessKnockoutProgression("round_1", config, teams, draftResults);
  assert.equal(draftState.allResultsPublished, false);
  assert.equal(draftState.canConfirm, false);
  assert.equal(
    assessKnockoutProgression("round_1", config, teams, draftResults.slice(0, 11)).canConfirm,
    false,
  );
});

test("a tie at the advancement cutoff requires an ordered admin decision and reason", () => {
  const teams = Array.from({ length: 12 }, (_, index) => index + 1);
  const results = resultsFor(teams);
  for (const teamNumber of [10, 11]) {
    const row = results.find((result) => result.teamNumber === teamNumber);
    row.placement = 10;
    row.placementPoints = 1;
    row.roundPoints = 1;
  }
  const unresolved = assessKnockoutProgression("round_1", config, teams, results);
  assert.deepEqual(unresolved.boundaryTieTeamNumbers, [10, 11]);
  assert.equal(unresolved.canConfirm, false);

  const resolved = assessKnockoutProgression("round_1", config, teams, results, {
    order: [11, 10],
    reason: "Verified tie decision by tournament administrator.",
  });
  assert.equal(resolved.canConfirm, true);
  assert.equal(resolved.rankedResults.find((row) => row.teamNumber === 11)?.status, "qualified");
  assert.equal(resolved.rankedResults.find((row) => row.teamNumber === 10)?.status, "eliminated");
  assert.equal(resolved.rankedResults.find((row) => row.teamNumber === 11)?.decisionReason, "Verified tie decision by tournament administrator.");
  assert.throws(
    () => assessKnockoutProgression("round_1", config, teams, results, {
      order: [10, 11],
      reason: "no",
    }),
    /5–500 characters/,
  );
});

test("unsupported bracket configuration and duplicate eligible teams are rejected", () => {
  assert.throws(
    () => assessKnockoutProgression("round_1", { ...config, squadCount: 2 }, [], []),
    /cannot advance/,
  );
  assert.throws(
    () => assessKnockoutProgression("round_1", config, [1, 1], []),
    /duplicate eligible squads/,
  );
});

test("configured smaller brackets remain supported without changing the default 12 → 10 → 8 path", () => {
  const round1 = assessKnockoutProgression(
    "round_1",
    { squadCount: 8, round1Eliminated: 1, round2Eliminated: 1 },
    [1, 2, 3, 4, 5, 6, 7, 8],
    resultsFor([1, 2, 3, 4, 5, 6, 7, 8]).map((result) => ({
      ...result,
      placementPoints: [12, 9, 8, 7, 6, 5, 4, 3][result.placement - 1],
      roundPoints: [12, 9, 8, 7, 6, 5, 4, 3][result.placement - 1],
    })),
  );
  assert.equal(round1.expectedSquads, 8);
  assert.equal(round1.advanceCount, 7);
});
