import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import {
  isAppLanguage,
  languagePreferenceKey,
  readLanguagePreference,
  resolveSignedInLanguagePreference,
  writeLanguagePreference,
} from '../src/i18n/languagePreference.ts';
import en from '../src/i18n/locales/en.ts';
import hi from '../src/i18n/locales/hi.ts';
import gu from '../src/i18n/locales/gu.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error?.code === 'ERR_MODULE_NOT_FOUND'
        && (specifier.startsWith('./') || specifier.startsWith('../'))
        && !/\.[a-z\d]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const { createLanguagePreferenceLifecycle } = await import(
  '../src/i18n/languagePreferenceLifecycle.ts'
);

function createStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

function createLifecycle({ initial = {}, readServerPreference = async () => null } = {}) {
  const store = createStore(initial);
  const appliedLanguages = [];
  const savedServerLanguages = [];
  const lifecycle = createLanguagePreferenceLifecycle({
    applyLanguage(language) {
      appliedLanguages.push(language);
    },
    localStore: store,
    readServerPreference,
    async saveServerPreference(language) {
      savedServerLanguages.push(language);
    },
  });
  return { lifecycle, store, appliedLanguages, savedServerLanguages };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRetryScheduler() {
  const tasks = [];
  return {
    tasks,
    scheduler: {
      schedule(callback, delayMs) {
        const task = { callback, delayMs, cancelled: false, ran: false };
        tasks.push(task);
        return task;
      },
      cancel(task) {
        task.cancelled = true;
      },
    },
    async runNext() {
      const task = tasks.find((candidate) => !candidate.cancelled && !candidate.ran);
      if (!task) return false;
      task.ran = true;
      await task.callback();
      return true;
    },
  };
}

test('new accounts have no saved preference and use English as the app default', async () => {
  const store = createStore();
  assert.equal(await readLanguagePreference('player-one', store), null);
  assert.equal(en['App language'], 'App language');
});

test('language preferences persist independently by Daily007 account ID', async () => {
  const store = createStore();
  await writeLanguagePreference('player-one', 'hi', store);
  await writeLanguagePreference('player-two', 'gu', store);

  assert.equal(await readLanguagePreference('player-one', store), 'hi');
  assert.equal(await readLanguagePreference('player-two', store), 'gu');
  assert.notEqual(languagePreferenceKey('player-one'), languagePreferenceKey('player-two'));
});

test('unsupported stored language values are ignored rather than applied', async () => {
  const store = createStore({
    [languagePreferenceKey('player-one')]: 'fr',
  });

  assert.equal(isAppLanguage('en'), true);
  assert.equal(isAppLanguage('hi'), true);
  assert.equal(isAppLanguage('gu'), true);
  assert.equal(isAppLanguage('fr'), false);
  assert.equal(await readLanguagePreference('player-one', store), null);
});

test('signed-in server preference wins and is not overwritten by another device cache', () => {
  assert.deepEqual(
    resolveSignedInLanguagePreference('gu', 'hi', 'en'),
    { language: 'gu', shouldPersistToServer: false },
  );
});

test('an intentional guest choice is carried to a new account when no server value exists', () => {
  assert.deepEqual(
    resolveSignedInLanguagePreference(null, 'hi', null),
    { language: 'hi', shouldPersistToServer: true },
  );
});

test('a legacy local account value migrates only when the server has no value', () => {
  assert.deepEqual(
    resolveSignedInLanguagePreference(null, null, 'gu'),
    { language: 'gu', shouldPersistToServer: true },
  );
});

test('a new account defaults to English without writing an unselected preference', () => {
  assert.deepEqual(
    resolveSignedInLanguagePreference(null, null, null),
    { language: 'en', shouldPersistToServer: false },
  );
});

test('sign-in restores the server preference and refreshes its account-scoped local cache', async () => {
  const { lifecycle, store, appliedLanguages, savedServerLanguages } = createLifecycle({
    initial: { [languagePreferenceKey('player-one')]: 'hi' },
    readServerPreference: async () => 'gu',
  });

  await lifecycle.setAccountId('player-one');

  assert.deepEqual(appliedLanguages, ['en', 'gu']);
  assert.equal(await readLanguagePreference('player-one', store), 'gu');
  assert.deepEqual(savedServerLanguages, []);
});

test('app resume restores a changed server preference without rewriting the server', async () => {
  let reads = 0;
  const { lifecycle, store, appliedLanguages, savedServerLanguages } = createLifecycle({
    readServerPreference: async () => {
      reads += 1;
      return reads === 1 ? 'hi' : 'gu';
    },
  });

  await lifecycle.setAccountId('player-one');
  await lifecycle.refreshOnResume('background');
  assert.equal(reads, 1, 'background transitions must not refresh language');

  await lifecycle.refreshOnResume('active');

  assert.deepEqual(appliedLanguages, ['en', 'hi', 'gu']);
  assert.equal(await readLanguagePreference('player-one', store), 'gu');
  assert.deepEqual(savedServerLanguages, []);
});

test('an intentional guest choice migrates to a signed-in account when the server is unset', async () => {
  const { lifecycle, store, appliedLanguages, savedServerLanguages } = createLifecycle();

  await lifecycle.setLanguage('hi');
  await lifecycle.setAccountId('player-one');

  assert.equal(appliedLanguages.at(-1), 'hi');
  assert.equal(await readLanguagePreference('player-one', store), 'hi');
  assert.deepEqual(savedServerLanguages, ['hi']);
});

test('a local preference remains usable when the sign-in server read is offline', async () => {
  const { lifecycle, appliedLanguages, savedServerLanguages } = createLifecycle({
    initial: { [languagePreferenceKey('player-one')]: 'gu' },
    readServerPreference: async () => {
      throw new Error('Network unavailable');
    },
  });

  await lifecycle.setAccountId('player-one');

  assert.deepEqual(appliedLanguages, ['en', 'gu']);
  assert.deepEqual(savedServerLanguages, []);
});

test('a delayed sign-in response cannot replace the next account language', async () => {
  const oldAccountRead = deferred();
  const oldAccountReadStarted = deferred();
  let reads = 0;
  const { lifecycle, appliedLanguages, savedServerLanguages } = createLifecycle({
    readServerPreference: () => {
      reads += 1;
      if (reads === 1) {
        oldAccountReadStarted.resolve();
        return oldAccountRead.promise;
      }
      return Promise.resolve('gu');
    },
  });

  const oldAccountSignIn = lifecycle.setAccountId('player-one');
  await oldAccountReadStarted.promise;
  await lifecycle.setAccountId('player-two');
  oldAccountRead.resolve('hi');
  await oldAccountSignIn;

  assert.deepEqual(appliedLanguages, ['en', 'en', 'gu']);
  assert.deepEqual(savedServerLanguages, []);
});

test('a delayed resume response cannot replace the language after an account switch', async () => {
  const oldResumeRead = deferred();
  let reads = 0;
  const { lifecycle, appliedLanguages } = createLifecycle({
    readServerPreference: () => {
      reads += 1;
      if (reads === 1) return Promise.resolve('en');
      if (reads === 2) return oldResumeRead.promise;
      return Promise.resolve('gu');
    },
  });

  await lifecycle.setAccountId('player-one');
  const oldResume = lifecycle.refreshOnResume('active');
  await lifecycle.setAccountId('player-two');
  oldResumeRead.resolve('hi');
  await oldResume;

  assert.deepEqual(appliedLanguages, ['en', 'en', 'en', 'gu']);
});

test('a signed-in language change still updates the local and server preferences', async () => {
  const { lifecycle, store, savedServerLanguages } = createLifecycle();
  await lifecycle.setAccountId('player-one');

  await lifecycle.setLanguage('hi');

  assert.equal(await readLanguagePreference('player-one', store), 'hi');
  assert.deepEqual(savedServerLanguages, ['hi']);
});

test('a failed language sync retries and clears pending state only after server confirmation', async () => {
  let attempts = 0;
  const store = createStore();
  const appliedLanguages = [];
  const lifecycle = createLanguagePreferenceLifecycle({
    applyLanguage(language) {
      appliedLanguages.push(language);
    },
    localStore: store,
    async readServerPreference() {
      return null;
    },
    async saveServerPreference(language) {
      attempts += 1;
      if (attempts === 1) throw new Error('Network unavailable');
      assert.equal(language, 'hi');
    },
  });
  await lifecycle.setAccountId('player-one');

  await assert.rejects(lifecycle.setLanguage('hi'), /Network unavailable/);
  assert.equal(await store.getItem('daily007:language:pending:v1:player-one'), 'hi');

  await lifecycle.retryPendingServerPreference();

  assert.equal(attempts, 2);
  assert.equal(await store.getItem('daily007:language:pending:v1:player-one'), null);
  assert.equal(await readLanguagePreference('player-one', store), 'hi');
  assert.equal(appliedLanguages.at(-1), 'hi');
});

test('a failed save retries after a delay and stops after server confirmation', async () => {
  const retry = createRetryScheduler();
  const store = createStore();
  let attempts = 0;
  const lifecycle = createLanguagePreferenceLifecycle({
    applyLanguage() {},
    localStore: store,
    readServerPreference: async () => null,
    retryDelayMs: 750,
    retryScheduler: retry.scheduler,
    async saveServerPreference() {
      attempts += 1;
      if (attempts === 1) throw new Error('Temporary API outage');
    },
  });
  await lifecycle.setAccountId('player-one');

  await assert.rejects(lifecycle.setLanguage('hi'), /Temporary API outage/);
  assert.equal(retry.tasks.length, 1);
  assert.equal(retry.tasks[0].delayMs, 750);
  assert.equal(await store.getItem('daily007:language:pending:v1:player-one'), 'hi');

  assert.equal(await retry.runNext(), true);

  assert.equal(attempts, 2);
  assert.equal(await store.getItem('daily007:language:pending:v1:player-one'), null);
  assert.equal(await retry.runNext(), false);
});

test('automatic retries are bounded while connectivity-triggered recovery remains available', async () => {
  const retry = createRetryScheduler();
  let attempts = 0;
  const lifecycle = createLanguagePreferenceLifecycle({
    applyLanguage() {},
    localStore: createStore(),
    readServerPreference: async () => null,
    retryScheduler: retry.scheduler,
    async saveServerPreference() {
      attempts += 1;
      throw new Error('Temporary API outage');
    },
  });
  await lifecycle.setAccountId('player-one');

  await assert.rejects(lifecycle.setLanguage('gu'), /Temporary API outage/);
  for (let count = 0; count < 3; count += 1) {
    assert.equal(await retry.runNext(), true);
  }

  assert.equal(attempts, 4, 'one initial save plus three bounded retries');
  assert.equal(await retry.runNext(), false);
  await lifecycle.retryPendingServerPreference();
  assert.equal(attempts, 5, 'a later connectivity event can still recover the pending choice');
});

test('a newer choice or account change cancels an older scheduled retry', async () => {
  const retry = createRetryScheduler();
  const savedServerLanguages = [];
  const lifecycle = createLanguagePreferenceLifecycle({
    applyLanguage() {},
    localStore: createStore(),
    readServerPreference: async () => null,
    retryScheduler: retry.scheduler,
    async saveServerPreference(language) {
      savedServerLanguages.push(language);
      if (language === 'hi') throw new Error('Temporary API outage');
    },
  });
  await lifecycle.setAccountId('player-one');

  await assert.rejects(lifecycle.setLanguage('hi'), /Temporary API outage/);
  await lifecycle.setLanguage('gu');
  assert.equal(retry.tasks[0].cancelled, true);
  await retry.tasks[0].callback();
  assert.equal(await retry.runNext(), false);
  assert.deepEqual(savedServerLanguages, ['hi', 'gu']);

  const accountRetry = createRetryScheduler();
  const accountScopedLifecycle = createLanguagePreferenceLifecycle({
    applyLanguage() {},
    localStore: createStore(),
    readServerPreference: async () => null,
    retryScheduler: accountRetry.scheduler,
    async saveServerPreference() {
      throw new Error('Temporary API outage');
    },
  });
  await accountScopedLifecycle.setAccountId('player-one');
  await assert.rejects(accountScopedLifecycle.setLanguage('hi'), /Temporary API outage/);
  await accountScopedLifecycle.setAccountId('player-two');

  assert.equal(accountRetry.tasks[0].cancelled, true);
  await accountRetry.tasks[0].callback();
  assert.equal(await accountRetry.runNext(), false);
});

test('a pending offline choice wins on sign-in and is retried instead of the stale server value', async () => {
  const store = createStore({
    'daily007:language:v1:player-one': 'hi',
    'daily007:language:pending:v1:player-one': 'hi',
  });
  const savedServerLanguages = [];
  const lifecycle = createLanguagePreferenceLifecycle({
    applyLanguage() {},
    localStore: store,
    async readServerPreference() {
      return 'gu';
    },
    async saveServerPreference(language) {
      savedServerLanguages.push(language);
    },
  });

  await lifecycle.setAccountId('player-one');

  assert.deepEqual(savedServerLanguages, ['hi']);
  assert.equal(await store.getItem('daily007:language:pending:v1:player-one'), null);
});

test('a recovered offline choice appears on another device and after reopening', async () => {
  const accountPreferences = new Map();
  const accountId = 'player-one';
  let networkAvailable = false;

  function createDevice(store) {
    const appliedLanguages = [];
    const lifecycle = createLanguagePreferenceLifecycle({
      applyLanguage(language) {
        appliedLanguages.push(language);
      },
      localStore: store,
      async readServerPreference() {
        if (!networkAvailable) throw new Error('Network unavailable');
        return accountPreferences.get(accountId) ?? null;
      },
      async saveServerPreference(language) {
        if (!networkAvailable) throw new Error('Network unavailable');
        accountPreferences.set(accountId, language);
      },
    });
    return { lifecycle, appliedLanguages };
  }

  const firstDeviceStore = createStore();
  const firstDevice = createDevice(firstDeviceStore);
  await firstDevice.lifecycle.setAccountId(accountId);
  await assert.rejects(firstDevice.lifecycle.setLanguage('gu'), /Network unavailable/);
  assert.equal(
    await firstDeviceStore.getItem('daily007:language:pending:v1:player-one'),
    'gu',
  );
  assert.equal(accountPreferences.has(accountId), false);

  networkAvailable = true;
  await firstDevice.lifecycle.retryPendingServerPreference();
  assert.equal(accountPreferences.get(accountId), 'gu');
  assert.equal(
    await firstDeviceStore.getItem('daily007:language:pending:v1:player-one'),
    null,
  );

  const secondDeviceStore = createStore();
  const secondDevice = createDevice(secondDeviceStore);
  await secondDevice.lifecycle.setAccountId(accountId);
  assert.equal(secondDevice.appliedLanguages.at(-1), 'gu');
  assert.equal(await readLanguagePreference(accountId, secondDeviceStore), 'gu');

  const reopenedSecondDevice = createDevice(secondDeviceStore);
  await reopenedSecondDevice.lifecycle.setAccountId(accountId);
  assert.equal(reopenedSecondDevice.appliedLanguages.at(-1), 'gu');
});

test('an in-flight retry cannot clear or overwrite a newer language selection', async () => {
  const retryConfirmation = deferred();
  const retryStarted = deferred();
  const newerConfirmation = deferred();
  const newerSaveStarted = deferred();
  const savedServerLanguages = [];
  let saveAttempts = 0;
  const store = createStore();
  const guardedLifecycle = createLanguagePreferenceLifecycle({
    applyLanguage() {},
    localStore: store,
    async readServerPreference() {
      return null;
    },
    async saveServerPreference(language) {
      savedServerLanguages.push(language);
      saveAttempts += 1;
      if (saveAttempts === 1) {
        throw new Error('Network unavailable');
      }
      if (saveAttempts === 2) {
        retryStarted.resolve();
        await retryConfirmation.promise;
      }
      if (saveAttempts === 3) {
        newerSaveStarted.resolve();
        await newerConfirmation.promise;
      }
    },
  });
  await guardedLifecycle.setAccountId('player-one');

  await assert.rejects(guardedLifecycle.setLanguage('hi'), /Network unavailable/);
  const retry = guardedLifecycle.retryPendingServerPreference();
  await retryStarted.promise;
  const newerChoice = guardedLifecycle.setLanguage('gu');

  retryConfirmation.resolve();
  await newerSaveStarted.promise;
  assert.equal(await store.getItem('daily007:language:pending:v1:player-one'), 'gu');
  assert.equal(await readLanguagePreference('player-one', store), 'gu');

  newerConfirmation.resolve();
  await Promise.all([retry, newerChoice]);

  assert.deepEqual(savedServerLanguages, ['hi', 'hi', 'gu']);
  assert.equal(await readLanguagePreference('player-one', store), 'gu');
  assert.equal(await store.getItem('daily007:language:pending:v1:player-one'), null);
});

test('Hindi and Gujarati resources cover the same keys as English', () => {
  assert.deepEqual(Object.keys(hi).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(gu).sort(), Object.keys(en).sort());
});

test('core navigation and tournament text has Hindi and Gujarati translations', () => {
  for (const key of [
    'HOME',
    'TOURNAMENTS',
    'WALLET',
    'PROFILE',
    'JOIN',
    'Battle Royale Solo',
    'Clash Squad 1 VS 1',
  ]) {
    assert.ok(hi[key], `Hindi should translate ${key}`);
    assert.ok(gu[key], `Gujarati should translate ${key}`);
    assert.notEqual(hi[key], en[key], `Hindi should not fall back to English for ${key}`);
    assert.notEqual(gu[key], en[key], `Gujarati should not fall back to English for ${key}`);
  }
});
