export const ROOM_CREDENTIAL_REVEAL_LEAD_MS = 5 * 60 * 1000;

export type RoomCredentialAccessState = {
  registrationStatus: string;
  tournamentStatus: string;
  roomId: string | null;
  roomPassword: string | null;
  startsAt: Date | null;
};

export function isRoomCredentialReleaseOpen(startsAt: Date | null, nowMs = Date.now()): boolean {
  const startMs = startsAt?.getTime();
  return Number.isFinite(startMs) && Number.isFinite(nowMs) &&
    nowMs >= startMs! - ROOM_CREDENTIAL_REVEAL_LEAD_MS;
}

export function canRevealRoomCredentials(
  state: RoomCredentialAccessState,
  nowMs = Date.now(),
): boolean {
  return state.registrationStatus === "approved" &&
    state.tournamentStatus !== "cancelled" &&
    Boolean(state.roomId?.trim()) &&
    Boolean(state.roomPassword?.trim()) &&
    isRoomCredentialReleaseOpen(state.startsAt, nowMs);
}