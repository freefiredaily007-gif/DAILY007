import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { openVideoInBrowser, openYouTubeVideo } from '../src/lib/video-links.ts';

const videoScreenSource = readFileSync(
  new URL('../src/screens/Video.tsx', import.meta.url),
  'utf8',
);
const recoverySource = readFileSync(
  new URL('../src/components/VideoLinkRecovery.tsx', import.meta.url),
  'utf8',
);
const nativeFixtureSource = readFileSync(
  new URL('../src/screens/VideoLinkRecoveryNativeTest.tsx', import.meta.url),
  'utf8',
);

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

test('Android reports the browser error after both YouTube and browser links fail', async () => {
  const openedUrls = [];
  const videoUrl = 'https://www.youtube.com/watch?v=abc-123';

  await assert.rejects(
    openYouTubeVideo('android', 'abc-123', videoUrl, async (url) => {
      openedUrls.push(url);
      throw new Error(url.startsWith('vnd.youtube:') ? 'No YouTube app handler' : 'No browser handler');
    }),
    /No browser handler/,
  );

  assert.deepEqual(openedUrls, ['vnd.youtube://abc-123', videoUrl]);
});

test('the recovery retry opens only the saved HTTPS URL', async () => {
  const openedUrls = [];
  const videoUrl = 'https://www.youtube.com/watch?v=abc-123';

  await openVideoInBrowser(videoUrl, async (url) => { openedUrls.push(url); });

  assert.deepEqual(openedUrls, [videoUrl]);
});

test('non-Android platforms keep opening the saved video URL', async () => {
  const openedUrls = [];
  const videoUrl = 'https://www.youtube.com/watch?v=abc-123';

  await openYouTubeVideo('ios', 'abc-123', videoUrl, async (url) => { openedUrls.push(url); });

  assert.deepEqual(openedUrls, [videoUrl]);
});

test('double failure offers browser retry and copy recovery without resetting selection or search', () => {
  const externalActionSource = videoScreenSource.slice(
    videoScreenSource.indexOf('const openOnYouTube ='),
    videoScreenSource.indexOf('const player = !selectedVideo'),
  );

  assert.match(externalActionSource, /setExternalLinkError\(true\)/);
  assert.match(externalActionSource, /openVideoInBrowser\(selectedVideo\.url/);
  assert.match(externalActionSource, /Clipboard\.setStringAsync\(selectedVideo\.url\)/);
  assert.doesNotMatch(
    externalActionSource,
    /setSelectedVideoId\(null\)|setSearchQuery\(['"]{2}\)|setShowPlayer\(false\)/,
  );
  assert.match(videoScreenSource, /<VideoLinkRecovery/);
  assert.match(recoverySource, /Couldn’t open this video in YouTube or your browser\./);
  assert.match(
    recoverySource,
    /if \(Platform\.OS === 'ios'\) AccessibilityInfo\.announceForAccessibility\(errorAnnouncement\)/,
    'VoiceOver should hear the initial external-link failure.',
  );
  assert.match(
    recoverySource,
    /if \(Platform\.OS === 'ios' && status\) AccessibilityInfo\.announceForAccessibility\(status\)/,
    'VoiceOver should hear retry and copy status feedback.',
  );
  assert.match(recoverySource, /testID="video-open-link-error"/);
  assert.match(recoverySource, /testID="video-retry-browser"/);
  assert.match(recoverySource, /accessibilityLabel="Retry opening the video in your browser"/);
  assert.match(recoverySource, /accessibilityLabel="Copy video link"/);
  assert.match(recoverySource, /accessibilityLiveRegion="polite"/);
  assert.match(recoverySource, /testID="video-open-link-status"/);
  assert.match(recoverySource, /selectable[\s\S]*?testID="video-manual-link"/);
  assert.ok(
    recoverySource.indexOf('testID="video-retry-browser"')
      < recoverySource.indexOf('testID="video-copy-link"'),
    'Browser retry should come before copy in the screen-reader control order.',
  );
  assert.match(videoScreenSource, /Video link copied\. Paste it into YouTube or a browser\./);
  assert.match(videoScreenSource, /Automatic copy failed\. Select and copy the video URL below\./);
  assert.match(nativeFixtureSource, /if \(!__DEV__\) return <Redirect href="\/" \/>/);
  assert.match(nativeFixtureSource, /The browser still could not open the video/);
  assert.match(nativeFixtureSource, /copyFails[\s\S]*?setManualUrl\(copyFails\)/);
  assert.match(nativeFixtureSource, /Selected video: Daily007 TalkBack recovery demo/);
  assert.match(nativeFixtureSource, /Catalog search: accessibility/);
  assert.match(videoScreenSource, /playerFailed && !externalLinkError/);
  assert.match(videoScreenSource, /value={searchQuery}/);
});
