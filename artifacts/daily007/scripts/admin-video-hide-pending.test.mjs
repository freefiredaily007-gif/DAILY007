import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { startVideoToggleRequest } from '../src/lib/adminVideoToggle.ts';

const screenSource = await readFile(new URL('../src/screens/AdminVideos.tsx', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('keeps the affected video visibly and accessibly pending until a delayed hide settles', async () => {
  const response = deferred();
  const pendingRef = { current: null };
  const pendingUpdates = [];
  let actionCalls = 0;

  const request = startVideoToggleRequest(
    'video-1',
    pendingRef,
    (id) => pendingUpdates.push(id),
    async () => {
      actionCalls += 1;
      await response.promise;
    },
  );

  assert.ok(request);
  assert.equal(pendingRef.current, 'video-1');
  assert.deepEqual(pendingUpdates, ['video-1']);

  const repeatedRequest = startVideoToggleRequest(
    'video-1',
    pendingRef,
    (id) => pendingUpdates.push(id),
    async () => {
      actionCalls += 1;
    },
  );
  assert.equal(repeatedRequest, null);
  assert.equal(actionCalls, 0);

  await Promise.resolve();
  assert.equal(actionCalls, 1);
  response.resolve();
  await request;

  assert.equal(pendingRef.current, null);
  assert.deepEqual(pendingUpdates, ['video-1', null]);

  assert.match(screenSource, /loading=\{pendingToggleVideoId === video\.id\}/);
  assert.match(screenSource, /accessibilityState=\{\{\s*busy: pendingToggleVideoId === video\.id/);
  assert.match(screenSource, /testID=\{`admin-video-toggle-pending-\$\{video\.id\}`\}/);
  assert.match(screenSource, /Hide request in progress\. Please wait\./);
  assert.match(screenSource, /accessibilityLiveRegion="polite"/);
});

test('releases the pending guard after a failed delayed request so the action can be retried', async () => {
  const response = deferred();
  const pendingRef = { current: null };
  const pendingUpdates = [];
  const request = startVideoToggleRequest(
    'video-1',
    pendingRef,
    (id) => pendingUpdates.push(id),
    () => response.promise,
  );

  assert.ok(request);
  await Promise.resolve();
  response.reject(new Error('request failed'));
  await assert.rejects(request, /request failed/);

  assert.equal(pendingRef.current, null);
  assert.deepEqual(pendingUpdates, ['video-1', null]);

  const retry = startVideoToggleRequest(
    'video-1',
    pendingRef,
    (id) => pendingUpdates.push(id),
    async () => undefined,
  );
  assert.ok(retry);
  await retry;
  assert.deepEqual(pendingUpdates, ['video-1', null, 'video-1', null]);
  assert.match(screenSource, /Could not \$\{action\} "\$\{video\.title\}": \$\{apiError\(cause\)\}/);
});
