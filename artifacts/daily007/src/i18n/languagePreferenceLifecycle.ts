import {
  isAppLanguage,
  readLanguagePreference,
  resolveSignedInLanguagePreference,
  writeLanguagePreference,
} from './languagePreference';
import type { AppLanguage, LanguagePreferenceStore } from './languagePreference';

type LanguagePreferenceLifecycleDependencies = {
  applyLanguage: (language: AppLanguage) => void | Promise<void>;
  localStore: LanguagePreferenceStore;
  readServerPreference: () => Promise<AppLanguage | null>;
  saveServerPreference: (language: AppLanguage) => Promise<void>;
};

export function createLanguagePreferenceLifecycle({
  applyLanguage,
  localStore,
  readServerPreference,
  saveServerPreference,
}: LanguagePreferenceLifecycleDependencies) {
  let activeAccountId: string | null = null;
  let guestLanguage: AppLanguage = 'en';
  let guestLanguageWasChosen = false;
  let operationVersion = 0;
  let pendingServerWrites = 0;
  let preferenceWriteQueue: Promise<void> = Promise.resolve();

  const persistAccountPreference = (
    userId: string,
    next: AppLanguage,
    syncToServer: boolean,
  ) => {
    if (syncToServer) pendingServerWrites += 1;
    const operation = preferenceWriteQueue.catch(() => {}).then(async () => {
      await Promise.all([
        writeLanguagePreference(userId, next, localStore),
        syncToServer ? saveServerPreference(next) : Promise.resolve(),
      ]);
    });
    preferenceWriteQueue = operation.then(() => undefined, () => undefined);
    return operation.finally(() => {
      if (syncToServer) pendingServerWrites -= 1;
    });
  };

  const setLanguage = async (next: AppLanguage): Promise<boolean> => {
    if (!isAppLanguage(next)) throw new Error('Unsupported language.');

    const version = ++operationVersion;
    await applyLanguage(next);
    if (version !== operationVersion) return false;

    const accountId = activeAccountId;
    if (accountId) {
      await persistAccountPreference(accountId, next, true);
      return true;
    }

    guestLanguage = next;
    guestLanguageWasChosen = true;
    return true;
  };

  const setAccountId = async (rawUserId: string | null) => {
    const userId = rawUserId?.trim() || null;
    if (activeAccountId === userId) return;

    activeAccountId = userId;
    const version = ++operationVersion;

    if (!userId) {
      guestLanguage = 'en';
      guestLanguageWasChosen = false;
      await applyLanguage('en');
      return;
    }

    // Never let a previous account's preference flash on another player's screen.
    await applyLanguage('en');
    if (version !== operationVersion || activeAccountId !== userId) return;

    const localPreference = await readLanguagePreference(userId, localStore).catch(() => null);
    let remotePreference: AppLanguage | null = null;
    let remoteReadSucceeded = false;
    try {
      remotePreference = await readServerPreference();
      remoteReadSucceeded = true;
    } catch {
      // Keep the existing local preference available while offline.
    }
    if (version !== operationVersion || activeAccountId !== userId) return;

    const selectedBeforeSignIn = guestLanguageWasChosen ? guestLanguage : null;
    const resolved = resolveSignedInLanguagePreference(
      remotePreference,
      selectedBeforeSignIn,
      localPreference,
    );
    await applyLanguage(resolved.language);
    if (version !== operationVersion || activeAccountId !== userId) return;
    await persistAccountPreference(
      userId,
      resolved.language,
      remoteReadSucceeded && resolved.shouldPersistToServer,
    ).catch(() => {});
    if (version === operationVersion && activeAccountId === userId) {
      guestLanguage = 'en';
      guestLanguageWasChosen = false;
    }
  };

  const refreshOnResume = async (appState: string): Promise<void> => {
    const userId = activeAccountId;
    if (appState !== 'active' || !userId || pendingServerWrites > 0) return;
    const version = operationVersion;
    try {
      const saved = await readServerPreference();
      if (!saved || version !== operationVersion || activeAccountId !== userId) return;
      await applyLanguage(saved);
      if (version !== operationVersion || activeAccountId !== userId) return;
      await persistAccountPreference(userId, saved, false);
    } catch {
      // Keep the last confirmed language if refresh is unavailable.
    }
  };

  return { setLanguage, setAccountId, refreshOnResume };
}
