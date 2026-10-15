import AsyncStorage from '@react-native-async-storage/async-storage';

export type PendingVideoRewardRetry = {
  accountId: string;
  sessionId: string;
  percent: number;
};

type KeyValueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const STORAGE_KEY_PREFIX = 'daily007_video_reward_retry_v1_';

export function createVideoRewardRetryStore(storage: KeyValueStorage) {
  const accountQueues = new Map<string, Promise<void>>();
  const keyForAccount = (accountId: string) =>
    `${STORAGE_KEY_PREFIX}${encodeURIComponent(accountId)}`;

  const enqueue = <T>(accountId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = accountQueues.get(accountId) ?? Promise.resolve();
    const queued = previous.catch(() => {}).then(operation);
    accountQueues.set(accountId, queued.then(() => undefined, () => undefined));
    return queued;
  };

  const load = async (accountId: string): Promise<PendingVideoRewardRetry | null> => {
    if (!accountId) return null;
    const key = keyForAccount(accountId);
    const raw = await storage.getItem(key);
    if (!raw) return null;

    try {
      const value = JSON.parse(raw) as Partial<PendingVideoRewardRetry>;
      if (
        value.accountId !== accountId ||
        typeof value.sessionId !== 'string' ||
        !value.sessionId ||
        typeof value.percent !== 'number' ||
        !Number.isFinite(value.percent) ||
        value.percent < 0 ||
        value.percent > 100
      ) {
        await storage.removeItem(key);
        return null;
      }
      return {
        accountId,
        sessionId: value.sessionId,
        percent: value.percent,
      };
    } catch {
      await storage.removeItem(key);
      return null;
    }
  };

  return {
    load(accountId: string) {
      if (!accountId) return Promise.resolve(null);
      return enqueue(accountId, () => load(accountId));
    },

    save(accountId: string, sessionId: string, percent: number): Promise<void> {
      if (
        !accountId ||
        !sessionId ||
        !Number.isFinite(percent) ||
        percent < 0 ||
        percent > 100
      ) {
        throw new Error('A valid account and video reward session are required.');
      }
      const retry: PendingVideoRewardRetry = { accountId, sessionId, percent };
      return enqueue(accountId, () =>
        storage.setItem(keyForAccount(accountId), JSON.stringify(retry)),
      );
    },

    clear(accountId: string, expectedSessionId?: string): Promise<void> {
      if (!accountId) return Promise.resolve();
      return enqueue(accountId, async () => {
        const key = keyForAccount(accountId);
        if (expectedSessionId) {
          const retry = await load(accountId);
          if (retry && retry.sessionId !== expectedSessionId) return;
        }
        await storage.removeItem(key);
      });
    },
  };
}

const videoRewardRetryStore = createVideoRewardRetryStore(AsyncStorage);

export const loadPendingVideoRewardRetry = videoRewardRetryStore.load;
export const savePendingVideoRewardRetry = videoRewardRetryStore.save;
export const clearPendingVideoRewardRetry = videoRewardRetryStore.clear;
