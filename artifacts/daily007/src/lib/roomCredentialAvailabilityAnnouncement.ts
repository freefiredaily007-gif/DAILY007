export type RoomCredentialAnnouncementKind = 'available' | 'updated';

export function createRoomCredentialAvailabilityAnnouncementTracker(): (
  tournamentId: string,
  credentialsAvailable: boolean,
  roomId: unknown,
  roomPassword: unknown,
) => RoomCredentialAnnouncementKind | null {
  const announcedCredentialsByTournament = new Map<
    string,
    { roomId: string; roomPassword: string }
  >();
  return (
    tournamentId: string,
    credentialsAvailable: boolean,
    roomId: unknown,
    roomPassword: unknown,
  ): RoomCredentialAnnouncementKind | null => {
    const id = tournamentId.trim();
    if (
      !id ||
      !credentialsAvailable ||
      typeof roomId !== 'string' ||
      !roomId.trim() ||
      typeof roomPassword !== 'string' ||
      !roomPassword.trim()
    ) {
      return null;
    }

    const previous = announcedCredentialsByTournament.get(id);
    if (!previous) {
      announcedCredentialsByTournament.set(id, { roomId, roomPassword });
      return 'available';
    }
    if (previous.roomId === roomId && previous.roomPassword === roomPassword) return null;

    announcedCredentialsByTournament.set(id, { roomId, roomPassword });
    return 'updated';
  };
}
