import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnockoutPrizeAwards,
  KNOCKOUT_PRIZE_DISTRIBUTION,
} from "../src/lib/daily007-knockout-prizes.ts";
import { isKnockoutSquadConfirmed } from "../src/lib/daily007-knockout-results.ts";

function topThreeRoster() {
  return Array.from({ length: 12 }, (_, index) => {
    const rank = Math.floor(index / 4) + 1;
    const slotNumber = (index % 4) + 1;
    return {
      registrationId: `registration-${rank}-${slotNumber}`,
      recipientUserId: `user-${rank}-${slotNumber}`,
      playerName: `Player ${rank}-${slotNumber}`,
      recipientName: `Player ${rank}-${slotNumber}`,
      teamNumber: rank,
      slotNumber,
      rank,
    };
  });
}

test("fixed Knockout awards divide the 1,000-coin pool across four roster seats", () => {
  const awards = buildKnockoutPrizeAwards(topThreeRoster());
  assert.equal(awards.length, 12);
  assert.deepEqual(
    KNOCKOUT_PRIZE_DISTRIBUTION.map((tier) => [
      tier.rank,
      tier.squadCoins,
      tier.playerCoins,
    ]),
    [[1, 500, 125], [2, 300, 75], [3, 200, 50]],
  );
  assert.deepEqual(
    [1, 2, 3].map((rank) =>
      awards.filter((award) => award.rank === rank)
        .reduce((sum, award) => sum + award.playerPrizeCoins, 0),
    ),
    [500, 300, 200],
  );
  assert.equal(awards.reduce((sum, award) => sum + award.playerPrizeCoins, 0), 1000);
});

test("Knockout awards reject incomplete or duplicated winning seats", () => {
  const roster = topThreeRoster();
  assert.throws(() => buildKnockoutPrizeAwards(roster.slice(0, 11)), /exactly four/);
  const duplicateSeat = [...roster];
  duplicateSeat[1] = { ...duplicateSeat[1], slotNumber: 1 };
  assert.throws(() => buildKnockoutPrizeAwards(duplicateSeat), /appears more than once/);
});

test("the 12-squad, 48-player bracket requires four fully paid seats and awards only the top three", () => {
  const squads = Array.from({ length: 12 }, (_, teamIndex) =>
    Array.from({ length: 4 }, (_, slotIndex) => ({
      registrationId: `registration-${teamIndex + 1}-${slotIndex + 1}`,
      recipientUserId: `user-${teamIndex + 1}-${slotIndex + 1}`,
      playerName: `Player ${teamIndex + 1}-${slotIndex + 1}`,
      recipientName: `Player ${teamIndex + 1}-${slotIndex + 1}`,
      teamNumber: teamIndex + 1,
      slotNumber: slotIndex + 1,
      rank: teamIndex + 1,
      registrationStatus: "approved",
      entryCoinsPaid: 10,
      hasMember: true,
    })),
  );
  assert.equal(squads.flat().length, 48);
  assert.ok(squads.every((roster) => isKnockoutSquadConfirmed(roster, 10)));
  const unpaid = squads[11].map((slot, index) =>
    index === 3 ? { ...slot, entryCoinsPaid: 9 } : slot,
  );
  assert.equal(isKnockoutSquadConfirmed(unpaid, 10), false);

  const awards = buildKnockoutPrizeAwards(
    squads.slice(0, 3).flat().map(({ registrationStatus: _status, entryCoinsPaid: _paid, hasMember: _member, ...recipient }) => recipient),
  );
  assert.equal(awards.length, 12);
  assert.deepEqual(
    awards.reduce((totals, award) => {
      totals[award.rank - 1] += award.playerPrizeCoins;
      return totals;
    }, [0, 0, 0]),
    [500, 300, 200],
  );
});
