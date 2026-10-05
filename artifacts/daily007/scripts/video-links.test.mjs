import assert from 'node:assert/strict';
import test from 'node:test';
import { openYouTubeVideo } from '../src/lib/video-links.ts';

test('Android opens the selected video in the YouTube app first', async () => {
  const openedUrls = [];

  await openYouTubeVideo(
    'android',
    'abc-123',
    'https://www.youtube.com/watch?v=abc-123',
    async (url) => { openedUrls.push(url); },
  );

  assert.deepEqual(openedUrls, ['vnd.youtube://abc-123']);
});

test('Android falls back to the saved browser URL if the YouTube app link fails', async () => {
  const openedUrls = [];
  const videoUrl = 'https://www.youtube.com/watch?v=abc-123';

  await openYouTubeVideo('android', 'abc-123', videoUrl, async (url) => {
    openedUrls.push(url);
    if (url.startsWith('vnd.youtube:')) throw new Error('No YouTube app handler');
  });

  assert.deepEqual(openedUrls, ['vnd.youtube://abc-123', videoUrl]);
});

test('non-Android platforms keep opening the saved video URL', async () => {
  const openedUrls = [];
  const videoUrl = 'https://www.youtube.com/watch?v=abc-123';

  await openYouTubeVideo('ios', 'abc-123', videoUrl, async (url) => { openedUrls.push(url); });

  assert.deepEqual(openedUrls, [videoUrl]);
});
