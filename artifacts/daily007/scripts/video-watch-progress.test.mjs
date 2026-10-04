import assert from 'node:assert/strict';
import test from 'node:test';
import { getCreditedVideoWatchSeconds } from '../src/lib/video-watch-progress.ts';

test('a long gap between playback samples does not count background time', () => {
  const previous = { currentTime: 20, receivedAt: 1_000 };

  assert.deepEqual(
    getCreditedVideoWatchSeconds(previous, 80, 61_000, 100),
    [],
  );
});

test('no progress is added until a foreground sample has established a new baseline', () => {
  const firstForegroundSample = { currentTime: 80, receivedAt: 61_000 };

  assert.deepEqual(
    getCreditedVideoWatchSeconds(
      null,
      firstForegroundSample.currentTime,
      firstForegroundSample.receivedAt,
      100,
    ),
    [],
  );
  assert.deepEqual(
    getCreditedVideoWatchSeconds(firstForegroundSample, 81, 62_000, 100),
    [80],
  );
});

test('ordinary one-second playback samples continue to earn watched seconds', () => {
  assert.deepEqual(
    getCreditedVideoWatchSeconds(
      { currentTime: 12, receivedAt: 10_000 },
      13,
      11_000,
      100,
    ),
    [12],
  );
});