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
