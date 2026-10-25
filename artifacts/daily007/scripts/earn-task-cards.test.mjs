import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  fileURLToPath(new URL('../src/screens/Earn.tsx', import.meta.url)),
  'utf8',
);

test('the Earn landing view contains only the three task cards', () => {
  const mainStart = source.indexOf('<KeyboardAwareScrollViewCompat');
  const mainEnd = source.indexOf('</KeyboardAwareScrollViewCompat>', mainStart);
  assert.notEqual(mainStart, -1);
  assert.notEqual(mainEnd, -1);

  const mainView = source.slice(mainStart, mainEnd);
  const cardIds = [...mainView.matchAll(/testID="earn-open-(invite|youtube|instagram)"/g)]
    .map((match) => match[1]);

  assert.deepEqual(cardIds, ['invite', 'youtube', 'instagram']);
  assert.doesNotMatch(
    mainView,
    /referral-copy-code|referral-open-link|youtube-task-open-channel|instagram-task-open-account|MY REFERRALS/,
  );
});

test('each task detail and its existing action stays inside the task sheet', () => {
  const modalStart = source.indexOf('<Modal');
  const modalEnd = source.indexOf('</Modal>', modalStart);
  assert.notEqual(modalStart, -1);
  assert.notEqual(modalEnd, -1);

  const taskSheet = source.slice(modalStart, modalEnd);
  for (const testId of [
    'referral-copy-code',
    'referral-copy-link',
    'referral-share-invite',
    'youtube-task-open-channel',
    'youtube-task-submit-claim',
    'instagram-task-open-account',
    'instagram-task-submit-claim',
  ]) {
    assert.ok(taskSheet.includes(`testID="${testId}"`), `expected ${testId} inside the sheet`);
  }

  for (const task of ['invite', 'youtube', 'instagram']) {
    assert.ok(taskSheet.includes(`activeTask === '${task}'`), `expected a ${task} detail view`);
  }
});
