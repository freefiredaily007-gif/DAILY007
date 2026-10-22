import type { AdminRegistration } from './api';

export type AdminWinningTeam = {
  teamNumber: number;
  registrations: AdminRegistration[];
};

function teamNumberFor(registration: AdminRegistration): number | null {
  const value = registration.teamNumber ?? registration.assignedGroupNumber;
  const teamNumber = Number(value);
  return Number.isSafeInteger(teamNumber) && teamNumber > 0 ? teamNumber : null;
}

export function groupApprovedRegistrationsByTeam(
  registrations: AdminRegistration[],
): AdminWinningTeam[] {
  const teams = new Map<number, AdminRegistration[]>();
  for (const registration of registrations) {
    if (registration.status !== 'approved') continue;
    const teamNumber = teamNumberFor(registration);
    if (teamNumber === null) continue;
    const members = teams.get(teamNumber) ?? [];
    members.push(registration);
    teams.set(teamNumber, members);
  }

  return [...teams.entries()]
    .sort(([left], [right]) => left - right)
    .map(([teamNumber, members]) => ({
      teamNumber,
      registrations: members.sort((left, right) => {
        const slotDifference = Number(left.slotNumber ?? Number.MAX_SAFE_INTEGER) -
          Number(right.slotNumber ?? Number.MAX_SAFE_INTEGER);
        return slotDifference || left.playerName.localeCompare(right.playerName);
      }),
    }));
}

export function exactPrizePerPlayer(
  prizePool: number,
  playerCount: number,
): number | null {
  if (
    !Number.isSafeInteger(prizePool) ||
    prizePool < 0 ||
    !Number.isSafeInteger(playerCount) ||
    playerCount < 1 ||
    prizePool % playerCount !== 0
  ) {
    return null;
  }
  return prizePool / playerCount;
}
