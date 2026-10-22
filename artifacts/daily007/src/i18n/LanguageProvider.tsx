import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';
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
import { isUsableNetworkState } from '../lib/focusedRetry';
import { i18n } from './index';
import { createLanguagePreferenceLifecycle } from './languagePreferenceLifecycle';
import {
  LANGUAGE_NATIVE_NAMES,
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

  const applyLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    void i18n.changeLanguage(next);
  }, []);

  const lifecycleRef = useRef<ReturnType<typeof createLanguagePreferenceLifecycle> | null>(null);
  if (!lifecycleRef.current) {
    lifecycleRef.current = createLanguagePreferenceLifecycle({
      applyLanguage,
      localStore: AsyncStorage,
      readServerPreference: Api.languagePreference,
      saveServerPreference: Api.saveLanguagePreference,
    });
  }
  const lifecycle = lifecycleRef.current;

  const setLanguage = useCallback(async (next: AppLanguage) => {
    const applied = await lifecycle.setLanguage(next);
    if (!applied) return;

    if (Platform.OS !== 'web') {
      AccessibilityInfo.announceForAccessibility(
        i18n.t('Language changed to {{language}}.', {
          language: LANGUAGE_NATIVE_NAMES[next],
        }),
      );
    }
  }, [lifecycle]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      void lifecycle.refreshOnResume(state);
    });
    return () => subscription.remove();
  }, [lifecycle]);

  useEffect(() => {
    let active = true;
    let networkEventRevision = 0;
    const initialRevision = networkEventRevision;
    const subscription = Network.addNetworkStateListener((networkState) => {
      networkEventRevision += 1;
      if (isUsableNetworkState(networkState)) {
        void lifecycle.retryPendingServerPreference();
      }
    });

    void Network.getNetworkStateAsync().then((networkState) => {
      if (
        active
        && networkEventRevision === initialRevision
        && isUsableNetworkState(networkState)
      ) {
        void lifecycle.retryPendingServerPreference();
      }
    }).catch(() => {});

    return () => {
      active = false;
      subscription.remove();
    };
  }, [lifecycle]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, setAccountId: lifecycle.setAccountId }}>
      {children}
    </LanguageContext.Provider>
  );
}
