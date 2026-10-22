import assert from 'node:assert/strict';
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
