import {
  clearPendingLanguagePreference,
  isAppLanguage,
  readPendingLanguagePreference,
  readLanguagePreference,
  resolveSignedInLanguagePreference,
  writePendingLanguagePreference,
  writeLanguagePreference,
} from './languagePreference';
import type { AppLanguage, LanguagePreferenceStore } from './languagePreference';

type LanguagePreferenceLifecycleDependencies = {
  applyLanguage: (language: AppLanguage) => void | Promise<void>;
  localStore: LanguagePreferenceStore;
  readServerPreference: () => Promise<AppLanguage | null>;
  saveServerPreference: (language: AppLanguage) => Promise<void>;
  retryDelayMs?: number;
  retryScheduler?: {
    schedule: (callback: () => void | Promise<void>, delayMs: number) => unknown;
    cancel: (handle: unknown) => void;
  };
};

export function createLanguagePreferenceLifecycle({
  applyLanguage,
  localStore,
  readServerPreference,
  saveServerPreference,
  retryDelayMs = 1_000,
  retryScheduler = {
    schedule: (callback, delayMs) => setTimeout(() => {
      void callback();
    }, delayMs),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
}: LanguagePreferenceLifecycleDependencies) {
  const maxServerRetries = 3;
  let activeAccountId: string | null = null;
  let guestLanguage: AppLanguage = 'en';
  let guestLanguageWasChosen = false;
  let operationVersion = 0;
  let pendingServerWrites = 0;
  let scheduledRetryAttempts = 0;
  let retryInFlightVersion: number | null = null;
  let retryTimer: unknown = null;
  let pendingServerPreference: {
    userId: string;
    language: AppLanguage;
    version: number;
  } | null = null;
  let preferenceWriteQueue: Promise<void> = Promise.resolve();

  const cancelScheduledRetry = () => {
    if (retryTimer === null) return;
    retryScheduler.cancel(retryTimer);
    retryTimer = null;
  };

  const schedulePendingRetry = (
    userId: string,
    language: AppLanguage,
    version: number,
  ) => {
    const pending = pendingServerPreference;
    if (
      retryTimer !== null
      || scheduledRetryAttempts >= maxServerRetries
      || pending?.userId !== userId
      || pending.language !== language
      || pending.version !== version
      || operationVersion !== version
      || activeAccountId !== userId
    ) return;

    retryTimer = retryScheduler.schedule(async () => {
      const currentPending = pendingServerPreference;
      if (
        currentPending?.userId !== userId
        || currentPending.language !== language
        || currentPending.version !== version
        || operationVersion !== version
        || activeAccountId !== userId
      ) return;

      retryTimer = null;
      await retryPendingServerPreference(true);
    }, retryDelayMs);
  };

  const persistAccountPreference = (
    userId: string,
    next: AppLanguage,
    syncToServer: boolean,
    version: number,
  ) => {
    const operation = preferenceWriteQueue.catch(() => {}).then(async () => {
      if (version !== operationVersion || activeAccountId !== userId) return;

      await writeLanguagePreference(userId, next, localStore);
      if (!syncToServer) return;

      await writePendingLanguagePreference(userId, next, localStore);
      const pending = pendingServerPreference;
      if (
        version !== operationVersion
        || activeAccountId !== userId
        || pending?.userId !== userId
        || pending.language !== next
        || pending.version !== version
      ) return;

      pendingServerWrites += 1;
      try {
        try {
          await saveServerPreference(next);
        } catch (error) {
          schedulePendingRetry(userId, next, version);
          throw error;
        }
        const latestPending = pendingServerPreference;
        if (
          latestPending?.userId === userId
          && latestPending.language === next
          && latestPending.version === version
          && version === operationVersion
          && activeAccountId === userId
        ) {
          await clearPendingLanguagePreference(userId, next, localStore);
          pendingServerPreference = null;
          cancelScheduledRetry();
          scheduledRetryAttempts = 0;
        }
      } finally {
        pendingServerWrites -= 1;
      }
    });
    preferenceWriteQueue = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const setLanguage = async (next: AppLanguage): Promise<boolean> => {
    if (!isAppLanguage(next)) throw new Error('Unsupported language.');

    cancelScheduledRetry();
    const version = ++operationVersion;
    scheduledRetryAttempts = 0;
    await applyLanguage(next);
    if (version !== operationVersion) return false;

    const accountId = activeAccountId;
    if (accountId) {
      pendingServerPreference = { userId: accountId, language: next, version };
      await persistAccountPreference(accountId, next, true, version);
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
    cancelScheduledRetry();
    scheduledRetryAttempts = 0;
    pendingServerPreference = null;

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
    const pendingPreference = await readPendingLanguagePreference(userId, localStore).catch(() => null);
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
    const language = pendingPreference ?? resolved.language;
    await applyLanguage(language);
    if (version !== operationVersion || activeAccountId !== userId) return;
    const shouldSync = pendingPreference !== null || (
      resolved.shouldPersistToServer &&
      (remoteReadSucceeded || selectedBeforeSignIn !== null)
    );
    if (shouldSync) {
      pendingServerPreference = {
        userId,
        language,
        version,
      };
    }
    await persistAccountPreference(
      userId,
      language,
      shouldSync,
      version,
    ).catch(() => {});
    if (version === operationVersion && activeAccountId === userId) {
      guestLanguage = 'en';
      guestLanguageWasChosen = false;
    }
  };

  const refreshOnResume = async (appState: string): Promise<void> => {
    const userId = activeAccountId;
    if (appState !== 'active' || !userId || pendingServerWrites > 0) return;
    if (pendingServerPreference?.userId === userId) {
      await retryPendingServerPreference();
      return;
    }
    const version = operationVersion;
    try {
      const saved = await readServerPreference();
      if (!saved || version !== operationVersion || activeAccountId !== userId) return;
      await applyLanguage(saved);
      if (version !== operationVersion || activeAccountId !== userId) return;
      await persistAccountPreference(userId, saved, false, version);
    } catch {
      // Keep the last confirmed language if refresh is unavailable.
    }
  };

  const retryPendingServerPreference = async (scheduled = false): Promise<void> => {
    const pending = pendingServerPreference;
    if (
      !pending
      || activeAccountId !== pending.userId
      || operationVersion !== pending.version
      || pendingServerWrites > 0
      || retryInFlightVersion === pending.version
      || (scheduled && scheduledRetryAttempts >= maxServerRetries)
    ) return;

    cancelScheduledRetry();
    if (scheduled) scheduledRetryAttempts += 1;
    retryInFlightVersion = pending.version;
    try {
      await persistAccountPreference(
        pending.userId,
        pending.language,
        true,
        pending.version,
      ).catch(() => {});
    } finally {
      if (retryInFlightVersion === pending.version) retryInFlightVersion = null;
    }
  };

  return { setLanguage, setAccountId, refreshOnResume, retryPendingServerPreference };
}
