export const SUPPORTED_LANGUAGES = ['en', 'hi', 'gu'] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_OPTIONS: ReadonlyArray<{
  value: AppLanguage;
  label: string;
}> = [
  { value: 'en', label: '🇬🇧 English' },
  { value: 'hi', label: '🇮🇳 हिन्दी' },
  { value: 'gu', label: '🇮🇳 ગુજરાતી' },
];

export const LANGUAGE_NATIVE_NAMES: Record<AppLanguage, string> = {
  en: 'English',
  hi: 'हिन्दी',
  gu: 'ગુજરાતી',
};

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string'
    && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export function resolveSignedInLanguagePreference(
  remote: AppLanguage | null,
  guest: AppLanguage | null,
  local: AppLanguage | null,
): { language: AppLanguage; shouldPersistToServer: boolean } {
  return {
    language: remote ?? guest ?? local ?? 'en',
    shouldPersistToServer: remote === null && (guest !== null || local !== null),
  };
}
export function languagePreferenceKey(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) throw new Error('A user ID is required to save a language preference.');
  return `daily007:language:v1:${encodeURIComponent(normalized)}`;
}

export interface LanguagePreferenceStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
}

export async function readLanguagePreference(
  userId: string,
  store: LanguagePreferenceStore,
): Promise<AppLanguage | null> {
  const saved = await store.getItem(languagePreferenceKey(userId));
  return isAppLanguage(saved) ? saved : null;
}

export async function writeLanguagePreference(
  userId: string,
  language: AppLanguage,
  store: LanguagePreferenceStore,
): Promise<void> {
  await store.setItem(languagePreferenceKey(userId), language);
}

function pendingLanguagePreferenceKey(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) throw new Error('A user ID is required to save a pending language preference.');
  return `daily007:language:pending:v1:${encodeURIComponent(normalized)}`;
}

function pendingLanguagePreferenceBaseKey(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) throw new Error('A user ID is required to save a pending language preference.');
  return `daily007:language:pending-base:v1:${encodeURIComponent(normalized)}`;
}

function confirmedLanguagePreferenceKey(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) throw new Error('A user ID is required to save a confirmed language preference.');
  return `daily007:language:confirmed:v1:${encodeURIComponent(normalized)}`;
}

const UNSET_LANGUAGE_PREFERENCE = '__unset__';

export async function readConfirmedLanguagePreference(
  userId: string,
  store: LanguagePreferenceStore,
): Promise<{ found: boolean; language: AppLanguage | null }> {
  const saved = await store.getItem(confirmedLanguagePreferenceKey(userId));
  if (saved === null) return { found: false, language: null };
  if (saved === UNSET_LANGUAGE_PREFERENCE) return { found: true, language: null };
  return isAppLanguage(saved)
    ? { found: true, language: saved }
    : { found: false, language: null };
}

export async function writeConfirmedLanguagePreference(
  userId: string,
  language: AppLanguage | null,
  store: LanguagePreferenceStore,
): Promise<void> {
  await store.setItem(
    confirmedLanguagePreferenceKey(userId),
    language ?? UNSET_LANGUAGE_PREFERENCE,
  );
}

export async function readPendingLanguagePreference(
  userId: string,
  store: LanguagePreferenceStore,
): Promise<AppLanguage | null> {
  const saved = await store.getItem(pendingLanguagePreferenceKey(userId));
  return isAppLanguage(saved) ? saved : null;
}

export async function writePendingLanguagePreference(
  userId: string,
  language: AppLanguage,
  store: LanguagePreferenceStore,
): Promise<void> {
  await store.setItem(pendingLanguagePreferenceKey(userId), language);
}

export async function readPendingLanguagePreferenceBase(
  userId: string,
  store: LanguagePreferenceStore,
): Promise<{ found: boolean; language: AppLanguage | null }> {
  const saved = await store.getItem(pendingLanguagePreferenceBaseKey(userId));
  if (saved === null) return { found: false, language: null };
  if (saved === UNSET_LANGUAGE_PREFERENCE) return { found: true, language: null };
  return isAppLanguage(saved)
    ? { found: true, language: saved }
    : { found: false, language: null };
}

export async function writePendingLanguagePreferenceBase(
  userId: string,
  language: AppLanguage | null,
  store: LanguagePreferenceStore,
): Promise<void> {
  await store.setItem(
    pendingLanguagePreferenceBaseKey(userId),
    language ?? UNSET_LANGUAGE_PREFERENCE,
  );
}

export async function clearPendingLanguagePreference(
  userId: string,
  language: AppLanguage,
  store: LanguagePreferenceStore,
): Promise<void> {
  const key = pendingLanguagePreferenceKey(userId);
  if (await store.getItem(key) !== language) return;

  if (store.removeItem) {
    await store.removeItem(key);
    await store.removeItem(pendingLanguagePreferenceBaseKey(userId));
  } else {
    await store.setItem(key, '');
    await store.setItem(pendingLanguagePreferenceBaseKey(userId), '');
  }
}
