import assert from "node:assert/strict";
import test from "node:test";

import {
  exactPrizePerPlayer,
  groupApprovedRegistrationsByTeam,
} from "../src/lib/adminWinningTeams.ts";

test("approved team registrations are grouped and ordered by team and seat", () => {
  const registrations = [
    { id: "t2-slot2", status: "approved", teamNumber: 2, slotNumber: 2, playerName: "Player B" },
    { id: "rejected", status: "rejected", teamNumber: 1, slotNumber: 1, playerName: "Rejected" },
    { id: "t1-slot2", status: "approved", assignedGroupNumber: 1, slotNumber: 2, playerName: "Player A2" },
    { id: "t1-slot1", status: "approved", teamNumber: 1, slotNumber: 1, playerName: "Player A1" },
    { id: "unassigned", status: "approved", playerName: "No Team" },
  ];

  const teams = groupApprovedRegistrationsByTeam(registrations);
  assert.deepEqual(
    teams.map((team) => ({
      teamNumber: team.teamNumber,
      memberIds: team.registrations.map((registration) => registration.id),
    })),
    [
      { teamNumber: 1, memberIds: ["t1-slot1", "t1-slot2"] },
      { teamNumber: 2, memberIds: ["t2-slot2"] },
    ],
  );
});

test("team prize shares are accepted only when the entire pool divides evenly", () => {
  assert.equal(exactPrizePerPlayer(50, 2), 25);
  assert.equal(exactPrizePerPlayer(100, 4), 25);
  assert.equal(exactPrizePerPlayer(51, 2), null);
  assert.equal(exactPrizePerPlayer(100, 0), null);
  assert.equal(exactPrizePerPlayer(-1, 2), null);
});
