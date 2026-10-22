import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import type { PropsWithChildren } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { i18n } from './index';
import {
  isAppLanguage,
  LANGUAGE_NATIVE_NAMES,
  readLanguagePreference,
  writeLanguagePreference,
} from './languagePreference';
import type { AppLanguage } from './languagePreference';

type Daily007LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => Promise<void>;
  setAccountId: (userId: string | null) => Promise<void>;
};

const LanguageContext = createContext<Daily007LanguageContextValue>({
  language: 'en',
  setLanguage: async () => undefined,
  setAccountId: async () => undefined,
});

const LocalizedTextEnabledContext = createContext(true);

export function useDaily007Language() {
  return useContext(LanguageContext);
}

export function useLocalizedTextEnabled() {
  return useContext(LocalizedTextEnabledContext);
}

export function LocalizedTextScope({
  enabled,
  children,
}: PropsWithChildren<{ enabled: boolean }>) {
  return (
    <LocalizedTextEnabledContext.Provider value={enabled}>
      {children}
    </LocalizedTextEnabledContext.Provider>
  );
}

export function Daily007LanguageProvider({ children }: PropsWithChildren) {
  const [language, setLanguageState] = useState<AppLanguage>('en');
  const activeAccountId = useRef<string | null>(null);
  const guestLanguage = useRef<AppLanguage>('en');
  const guestLanguageWasChosen = useRef(false);
  const operationVersion = useRef(0);

  const applyLanguage = useCallback(async (next: AppLanguage) => {
    setLanguageState(next);
    await i18n.changeLanguage(next);
  }, []);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    if (!isAppLanguage(next)) throw new Error('Unsupported language.');

    const version = ++operationVersion.current;
    await applyLanguage(next);
    if (version !== operationVersion.current) return;

    if (Platform.OS !== 'web') {
      AccessibilityInfo.announceForAccessibility(
        i18n.t('Language changed to {{language}}.', {
          language: LANGUAGE_NATIVE_NAMES[next],
        }),
      );
    }

    const accountId = activeAccountId.current;
    if (accountId) {
      await writeLanguagePreference(accountId, next, AsyncStorage);
      return;
    }

    guestLanguage.current = next;
    guestLanguageWasChosen.current = true;
  }, [applyLanguage]);

  const setAccountId = useCallback(async (rawUserId: string | null) => {
    const userId = rawUserId?.trim() || null;
    if (activeAccountId.current === userId) return;

    activeAccountId.current = userId;
    const version = ++operationVersion.current;

    if (!userId) {
      guestLanguage.current = 'en';
      guestLanguageWasChosen.current = false;
      await applyLanguage('en');
      return;
    }

    // Never let a previous account's preference flash on another player's screen.
    await applyLanguage('en');
    if (version !== operationVersion.current || activeAccountId.current !== userId) return;

    try {
      const saved = await readLanguagePreference(userId, AsyncStorage);
      if (version !== operationVersion.current || activeAccountId.current !== userId) return;

      if (saved) {
        await applyLanguage(saved);
      } else if (guestLanguageWasChosen.current) {
        const selectedBeforeSignIn = guestLanguage.current;
        await applyLanguage(selectedBeforeSignIn);
        await writeLanguagePreference(userId, selectedBeforeSignIn, AsyncStorage);
      } else {
        await applyLanguage('en');
      }
    } catch {
      if (version === operationVersion.current && activeAccountId.current === userId) {
        await applyLanguage('en');
      }
    } finally {
      if (version === operationVersion.current && activeAccountId.current === userId) {
        guestLanguage.current = 'en';
        guestLanguageWasChosen.current = false;
      }
    }
  }, [applyLanguage]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, setAccountId }}>
      {children}
    </LanguageContext.Provider>
  );
}
