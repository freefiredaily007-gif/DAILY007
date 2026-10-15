import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const storeSource = readFileSync(
  new URL('../src/lib/video-reward-retry.ts', import.meta.url),
  'utf8',
);
const storeSourceFile = ts.createSourceFile(
  'video-reward-retry.ts',
  storeSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const videoSource = readFileSync(
  new URL('../src/screens/Video.tsx', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

function loadStoreFactory() {
  let declaration;
  for (const statement of storeSourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'createVideoRewardRetryStore'
    ) {
      declaration = statement;
      break;
    }
  }
  assert.ok(declaration, 'The retry store factory should be exported.');
  const source = declaration.getText(storeSourceFile).replace(/^export\s+/, '');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(
    'STORAGE_KEY_PREFIX',
    `${javascript}\nreturn createVideoRewardRetryStore;`,
  )('daily007_video_reward_retry_v1_');
}

function createStorage() {
  const entries = new Map();
  return {
    entries,
    async getItem(key) {
      return entries.get(key) ?? null;
    },
    async setItem(key, value) {
      entries.set(key, value);
    },
    async removeItem(key) {
      entries.delete(key);
    },
  };
}

test('a reward retry survives store recreation and remains scoped to its account', async () => {
  const storage = createStorage();
  const createStore = loadStoreFactory();
  const firstProcess = createStore(storage);

  await firstProcess.save('player-1', 'original-session', 82.5);

  const restartedProcess = createStore(storage);
  assert.deepEqual(await restartedProcess.load('player-1'), {
    accountId: 'player-1',
    sessionId: 'original-session',
    percent: 82.5,
  });
  assert.equal(await restartedProcess.load('player-2'), null);
});

test('clearing a completed session does not remove a newer retry; sign-out clears the account entry', async () => {
  const storage = createStorage();
  const store = loadStoreFactory()(storage);

  await store.save('player-1', 'new-session', 91);
  await store.clear('player-1', 'old-session');
  assert.equal((await store.load('player-1'))?.sessionId, 'new-session');

  await store.clear('player-1');
  assert.equal(await store.load('player-1'), null);
});

test('sign-out cleanup waits for an already-started retry save', async () => {
  const entries = new Map();
  let finishWrite;
  let signalWriteStarted;
  const writeStarted = new Promise((resolve) => { signalWriteStarted = resolve; });
  const storage = {
    async getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      signalWriteStarted();
      return new Promise((resolve) => {
        finishWrite = () => {
          entries.set(key, value);
          resolve();
        };
      });
    },
    async removeItem(key) {
      entries.delete(key);
    },
  };
  const store = loadStoreFactory()(storage);
  const save = store.save('player-1', 'pending-session', 78);
  await writeStarted;
  const clear = store.clear('player-1');
  finishWrite();
  await Promise.all([save, clear]);
  assert.equal(await store.load('player-1'), null);
});

test('invalid or mismatched stored references are discarded', async () => {
  const storage = createStorage();
  const store = loadStoreFactory()(storage);
  const key = 'daily007_video_reward_retry_v1_player-1';

  storage.entries.set(key, JSON.stringify({
    accountId: 'player-2',
    sessionId: 'other-account-session',
    percent: 80,
  }));
  assert.equal(await store.load('player-1'), null);
  assert.equal(storage.entries.has(key), false);

  storage.entries.set(key, '{broken json');
  assert.equal(await store.load('player-1'), null);
  assert.equal(storage.entries.has(key), false);
});

test('the Video screen persists before claiming and restores a catalog retry without starting playback', () => {
  assert.match(
    videoSource,
    /await savePendingVideoRewardRetry\(accountId, sessionId, percentWatched\);[\s\S]*?const result = await completeVideoWatch/,
    'The claim reference should be durable before the API request begins.',
  );
  assert.match(
    videoSource,
    /loadPendingVideoRewardRetry\(accountId\)\.then\(\(retry\) => \{[\s\S]*?setRetrySession/,
    'The signed-in account should restore its pending retry.',
  );
  assert.match(videoSource, /testID="video-retry-claim"/);
  assert.match(
    videoSource,
    /claimViewReward\(retrySession\.sessionId, retrySession\.percent\)/,
    'Restored retries must submit the original session and percentage.',
  );
  const logoutStart = appSource.indexOf('const logout = useCallback(async () => {');
  const logoutClear = appSource.indexOf('await clearPendingVideoRewardRetry(accountId)', logoutStart);
  const logoutSessionClear = appSource.indexOf('await setSession(null)', logoutStart);
  assert.ok(
    logoutStart >= 0 && logoutClear > logoutStart && logoutSessionClear > logoutClear,
    'Logout should clear the account-scoped retry before removing the signed-in session.',
  );
});
