export const ROOM_CREDENTIAL_REVEAL_LEAD_MS = 5 * 60 * 1000;
export const ROOM_CREDENTIAL_PENDING_REFRESH_INTERVAL_MS = 30 * 1000;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export type RoomCredentialSchedule = {
  startsAtMs: number;
  releaseAtMs: number;
  date: string;
  startTime24: string;
  releaseTime24: string;
};

export function hasServerAuthorizedRoomCredentials(
  roomId: unknown,
  roomPassword: unknown,
): boolean {
  return typeof roomId === 'string' &&
    roomId.trim().length > 0 &&
    typeof roomPassword === 'string' &&
    roomPassword.trim().length > 0;
}

export function getRoomCredentialReleaseDelayMs(
  releaseAtMs: number,
  serverNowMs: number,
): number | null {
  if (!Number.isFinite(releaseAtMs) || !Number.isFinite(serverNowMs)) return null;
  const delayMs = releaseAtMs - serverNowMs;
  return delayMs > 0 ? delayMs : null;
}

export function getNextRoomCredentialRefreshAtMs(
  startsAtMs: number,
  releaseAtMs: number,
  registrationStatus: unknown,
  nowMs: number,
): number | null {
  if (
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(releaseAtMs) ||
    !Number.isFinite(nowMs) ||
    startsAtMs <= nowMs
  ) {
    return null;
  }

  const status = String(registrationStatus ?? '').toLowerCase();
  if (status !== 'approved' && status !== 'pending') return null;
  if (releaseAtMs > nowMs) return releaseAtMs;
  if (status !== 'pending') return null;

  return Math.min(nowMs + ROOM_CREDENTIAL_PENDING_REFRESH_INTERVAL_MS, startsAtMs);
}

function time24(timestamp: number): string {
  const istDate = new Date(timestamp + IST_OFFSET_MS);
  return `${String(istDate.getUTCHours()).padStart(2, '0')}:${String(istDate.getUTCMinutes()).padStart(2, '0')}`;
}

export function getRoomCredentialSchedule(
  startsAt: Date | string | null | undefined,
): RoomCredentialSchedule | null {
  const startsAtMs = startsAt instanceof Date
    ? startsAt.getTime()
    : Date.parse(String(startsAt ?? ''));
  if (!Number.isFinite(startsAtMs)) return null;

  const releaseAtMs = startsAtMs - ROOM_CREDENTIAL_REVEAL_LEAD_MS;
  const istStart = new Date(startsAtMs + IST_OFFSET_MS);
  const date = `${String(istStart.getUTCDate()).padStart(2, '0')} ${MONTHS[istStart.getUTCMonth()]} ${istStart.getUTCFullYear()}`;
  return {
    startsAtMs,
    releaseAtMs,
    date,
    startTime24: time24(startsAtMs),
    releaseTime24: time24(releaseAtMs),
  };
}