export function createRoomCredentialAvailabilityAnnouncementTracker() {
  const announcedTournamentIds = new Set<string>();
  return (tournamentId: string, credentialsAvailable: boolean): boolean => {
    const id = tournamentId.trim();
    if (!id || !credentialsAvailable || announcedTournamentIds.has(id)) return false;
    announcedTournamentIds.add(id);
    return true;
  };
}
