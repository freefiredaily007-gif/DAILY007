type RoomRegistration = {
  tournamentId?: unknown;
  status?: unknown;
  credentialsAvailable?: unknown;
};

export type TournamentRoomDetailsRefreshTrigger =
  | 'focus'
  | 'scheduled'
  | 'room-release'
  | 'resume'
  | 'connectivity'
  | 'manual';

export function createTournamentRoomDetailsAnnouncementTracker(): (
  trigger: TournamentRoomDetailsRefreshTrigger,
  registrations: RoomRegistration[],
) => number {
  const previousByTournament = new Map<
    string,
    { status: string; credentialsAvailable: boolean }
  >();
  const announcedForTournament = new Set<string>();

  return (trigger, registrations) => {
    let newlyAvailableCount = 0;

    for (const registration of registrations) {
      const tournamentId = String(registration.tournamentId ?? '').trim();
      if (!tournamentId) continue;

      const status = String(registration.status ?? '').toLowerCase();
      const credentialsAvailable = registration.credentialsAvailable === true;
      const previous = previousByTournament.get(tournamentId);
      const becameApproved = previous !== undefined &&
        previous.status !== 'approved' &&
        status === 'approved';
      const approvedCredentialsBecameAvailable = previous?.status === 'approved' &&
        !previous.credentialsAvailable &&
        credentialsAvailable;

      if (
        (trigger === 'scheduled' || trigger === 'room-release') &&
        status === 'approved' &&
        credentialsAvailable &&
        (becameApproved || approvedCredentialsBecameAvailable) &&
        !announcedForTournament.has(tournamentId)
      ) {
        announcedForTournament.add(tournamentId);
        newlyAvailableCount += 1;
      }

      previousByTournament.set(tournamentId, { status, credentialsAvailable });
    }

    return newlyAvailableCount;
  };
}
