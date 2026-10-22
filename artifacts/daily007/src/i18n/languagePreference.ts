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
