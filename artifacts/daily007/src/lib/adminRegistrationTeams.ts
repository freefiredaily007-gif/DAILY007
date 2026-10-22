import type { AdminRegistration } from './api';

export type AdminRegistrationTeamCard = {
  key: string;
  teamNumber: number | null;
  title: string;
  registrations: AdminRegistration[];
};

function positiveTeamNumber(registration: AdminRegistration): number | null {
  for (const value of [registration.teamNumber, registration.assignedGroupNumber]) {
    const number = Number(value);
    if (Number.isSafeInteger(number) && number > 0) return number;
  }
  return null;
}

export function getAdminRegistrationPlayerName(registration: AdminRegistration): string {
  return String(registration.playerName || registration.userName || 'Player').trim() || 'Player';
}

export function getAdminRegistrationPlayerUid(registration: AdminRegistration): string {
  return String(registration.gameUid || registration.captainGameUid || '').trim();
}

export function groupAdminRegistrationsByTeam(
  registrations: readonly AdminRegistration[],
): AdminRegistrationTeamCard[] {
  const groups = new Map<number | null, AdminRegistration[]>();
  for (const registration of registrations) {
    if (registration.status !== 'approved') continue;
    const teamNumber = positiveTeamNumber(registration);
    const teamRows = groups.get(teamNumber) ?? [];
    teamRows.push(registration);
    groups.set(teamNumber, teamRows);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === null) return 1;
      if (right === null) return -1;
      return left - right;
    })
    .map(([teamNumber, rows]) => ({
      key: teamNumber === null ? 'unassigned' : String(teamNumber),
      teamNumber,
      title: teamNumber === null
        ? 'UNASSIGNED PLAYERS'
        : `TEAM ${String(teamNumber).padStart(2, '0')}`,
      registrations: rows.sort((left, right) => {
        const slotDifference = Number(left.slotNumber ?? Number.MAX_SAFE_INTEGER) -
          Number(right.slotNumber ?? Number.MAX_SAFE_INTEGER);
        return slotDifference || getAdminRegistrationPlayerName(left)
          .localeCompare(getAdminRegistrationPlayerName(right));
      }),
    }));
}

export function collectAdminRegistrationUids(
  registrations: readonly AdminRegistration[],
): string[] {
  return registrations
    .filter((registration) => registration.status === 'approved')
    .map(getAdminRegistrationPlayerUid)
    .filter(Boolean);
}
