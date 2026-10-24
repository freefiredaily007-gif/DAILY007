import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const earnScreen = await readFile(
  new URL('../src/screens/Earn.tsx', import.meta.url),
  'utf8',
);
const adminScreen = await readFile(
  new URL('../src/screens/AdminEarnTasks.tsx', import.meta.url),
  'utf8',
);

test('player Instagram task submits without username or proof fields', () => {
  assert.doesNotMatch(earnScreen, /instagram-task-username|instagram-task-proof|Instagram username|Proof \/ note/i);
  assert.match(earnScreen, /data: \{\}/);
  assert.match(earnScreen, /testID="instagram-task-open-account"/);
  assert.match(earnScreen, /testID="instagram-task-submit-claim"/);
  assert.match(earnScreen, /submit your claim for review/i);
});

test('admin Instagram review uses the player Daily007 account identity only', () => {
  assert.match(adminScreen, /Daily007 user ID: \{claim\.userId\}/);
  assert.match(adminScreen, /claim\.userName/);
  assert.match(adminScreen, /claim\.email/);
  assert.doesNotMatch(adminScreen, /instagramUsername|proofText/);
  assert.match(adminScreen, /verify this Daily007 account's Instagram follow/);
});
test('approved Instagram claims show the credited reward and transaction to the player', () => {
  assert.match(earnScreen, /instagramTask\?\.completed/);
  assert.match(earnScreen, /TASK COMPLETED · \{\{count\}\} COINS CREDITED/);
  assert.match(earnScreen, /instagramTask\.claim\?\.rewardCoins \?\? instagramTask\.rewardCoins/);
  assert.match(earnScreen, /Transaction ID: \{\{id\}\}/);
});
