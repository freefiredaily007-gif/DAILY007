export type VideoPlaybackSample = {
  currentTime: number;
  receivedAt: number;
};

const MAX_PLAYBACK_SAMPLE_GAP_MS = 2_500;

export function getCreditedVideoWatchSeconds(
  previous: VideoPlaybackSample | null,
  currentTime: number,
  receivedAt: number,
  duration: number,
): number[] {
  if (!previous) return [];

  const elapsedMs = receivedAt - previous.receivedAt;
  const elapsedSeconds = elapsedMs / 1000;
  const advanceSeconds = currentTime - previous.currentTime;
  const plausibleAdvance = Number.isFinite(elapsedSeconds) &&
    elapsedMs > 0 &&
    elapsedMs <= MAX_PLAYBACK_SAMPLE_GAP_MS &&
    advanceSeconds > 0 &&
    advanceSeconds <= elapsedSeconds * 2.1 + 0.75;
  if (!plausibleAdvance || !Number.isFinite(duration) || duration <= 0) return [];

  const firstSecond = Math.max(0, Math.floor(previous.currentTime));
  const lastSecondExclusive = Math.min(Math.floor(currentTime), Math.ceil(duration));
  const seconds: number[] = [];
  for (let second = firstSecond; second < lastSecondExclusive; second += 1) {
    seconds.push(second);
  }
  return seconds;
}