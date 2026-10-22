import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, AccessibilityInfo, Platform } from 'react-native';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { PropsWithChildren } from 'react';
import { Api } from '../lib/api';
import { i18n } from './index';
import {
  isAppLanguage,
  LANGUAGE_NATIVE_NAMES,
  readLanguagePreference,
  resolveSignedInLanguagePreference,
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
  const pendingServerWrites = useRef(0);
  const preferenceWriteQueue = useRef<Promise<void>>(Promise.resolve());

  const applyLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    void i18n.changeLanguage(next);
  }, []);

  const persistAccountPreference = useCallback((
    userId: string,
    next: AppLanguage,
    syncToServer: boolean,
  ) => {
    if (syncToServer) pendingServerWrites.current += 1;
    const operation = preferenceWriteQueue.current.catch(() => {}).then(async () => {
      await Promise.all([
        writeLanguagePreference(userId, next, AsyncStorage),
        syncToServer ? Api.saveLanguagePreference(next) : Promise.resolve(),
      ]);
    });
    preferenceWriteQueue.current = operation.then(() => undefined, () => undefined);
    return operation.finally(() => {
      if (syncToServer) pendingServerWrites.current -= 1;
    });
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
      await persistAccountPreference(accountId, next, true);
      return;
    }

    guestLanguage.current = next;
    guestLanguageWasChosen.current = true;
  }, [applyLanguage, persistAccountPreference]);

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

    const localPreference = await readLanguagePreference(userId, AsyncStorage).catch(() => null);
    let remotePreference: AppLanguage | null = null;
    let remoteReadSucceeded = false;
    try {
      remotePreference = await Api.languagePreference();
      remoteReadSucceeded = true;
    } catch {
      // Keep the existing local preference available while offline.
    }
    if (version !== operationVersion.current || activeAccountId.current !== userId) return;

    const selectedBeforeSignIn = guestLanguageWasChosen.current
      ? guestLanguage.current
      : null;
    const resolved = resolveSignedInLanguagePreference(
      remotePreference,
      selectedBeforeSignIn,
      localPreference,
    );
    await applyLanguage(resolved.language);
    if (version !== operationVersion.current || activeAccountId.current !== userId) return;
    await persistAccountPreference(
      userId,
      resolved.language,
      remoteReadSucceeded && resolved.shouldPersistToServer,
    ).catch(() => {});
    if (version === operationVersion.current && activeAccountId.current === userId) {
      guestLanguage.current = 'en';
      guestLanguageWasChosen.current = false;
    }
  }, [applyLanguage, persistAccountPreference]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const userId = activeAccountId.current;
      if (state !== 'active' || !userId || pendingServerWrites.current > 0) return;
      const version = operationVersion.current;
      void (async () => {
        try {
          const saved = await Api.languagePreference();
          if (!saved || version !== operationVersion.current ||
              activeAccountId.current !== userId) return;
          await applyLanguage(saved);
          if (version !== operationVersion.current ||
              activeAccountId.current !== userId) return;
          await persistAccountPreference(userId, saved, false);
        } catch {
          // Keep the last confirmed language if refresh is unavailable.
        }
      })();
    });
    return () => subscription.remove();
  }, [applyLanguage, persistAccountPreference]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, setAccountId }}>
      {children}
    </LanguageContext.Provider>
  );
}
