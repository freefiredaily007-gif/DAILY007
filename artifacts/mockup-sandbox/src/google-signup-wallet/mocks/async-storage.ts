const entries = new Map<string, string>();
const DAILY007_SESSION_KEY = "daily007_v2_session";
const PERSISTENT_ENTRY_PREFIX = "daily007-test-async-storage:";
let persistEntriesAcrossReload = false;
let rejectedSessionWritesRemaining = 0;
let sessionWriteAttempts = 0;
let rejectedSessionWrites = 0;
let holdNextSessionWrite = false;
let heldSessionWriteResolver: (() => void) | null = null;

export const storage = {
  async getItem(key: string) {
    return entries.get(key)
      ?? (persistEntriesAcrossReload ? window.localStorage.getItem(`${PERSISTENT_ENTRY_PREFIX}${key}`) : null);
  },
  async setItem(key: string, value: string) {
    if (key === DAILY007_SESSION_KEY) {
      sessionWriteAttempts += 1;
      if (rejectedSessionWritesRemaining > 0) {
        rejectedSessionWritesRemaining -= 1;
        rejectedSessionWrites += 1;
        throw new Error("Mock AsyncStorage rejected setItem.");
      }
      if (holdNextSessionWrite) {
        holdNextSessionWrite = false;
        await new Promise<void>((resolve) => {
          heldSessionWriteResolver = resolve;
        });
        heldSessionWriteResolver = null;
      }
    }
    entries.set(key, value);
    if (persistEntriesAcrossReload) {
      window.localStorage.setItem(`${PERSISTENT_ENTRY_PREFIX}${key}`, value);
    }
  },
  async removeItem(key: string) {
    entries.delete(key);
    if (persistEntriesAcrossReload) {
      window.localStorage.removeItem(`${PERSISTENT_ENTRY_PREFIX}${key}`);
    }
  },
  clear(options: { preservePersistent?: boolean } = {}) {
    heldSessionWriteResolver?.();
    heldSessionWriteResolver = null;
    entries.clear();
    if (!options.preservePersistent) {
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(PERSISTENT_ENTRY_PREFIX)) window.localStorage.removeItem(key);
      }
    }
    rejectedSessionWritesRemaining = 0;
    sessionWriteAttempts = 0;
    rejectedSessionWrites = 0;
    holdNextSessionWrite = false;
  },
  enablePersistentMode() {
    persistEntriesAcrossReload = true;
  },
  failNextSessionWrite() {
    this.failSessionWrites(1);
  },
  failSessionWrites(count: number) {
    rejectedSessionWritesRemaining += count;
  },
  holdNextSessionWrite() {
    holdNextSessionWrite = true;
  },
  releaseHeldSessionWrite() {
    if (!heldSessionWriteResolver) return false;
    const resolve = heldSessionWriteResolver;
    heldSessionWriteResolver = null;
    resolve();
    return true;
  },
  hasHeldSessionWrite() {
    return heldSessionWriteResolver !== null;
  },
  seedSession(session: unknown) {
    const value = JSON.stringify(session);
    entries.set(DAILY007_SESSION_KEY, value);
    if (persistEntriesAcrossReload) {
      window.localStorage.setItem(`${PERSISTENT_ENTRY_PREFIX}${DAILY007_SESSION_KEY}`, value);
    }
  },
  writeMetrics() {
    return { sessionWriteAttempts, rejectedSessionWrites };
  },
  snapshot() {
    const snapshot = Object.fromEntries(entries.entries());
    if (!persistEntriesAcrossReload) return snapshot;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PERSISTENT_ENTRY_PREFIX)) {
        snapshot[key.slice(PERSISTENT_ENTRY_PREFIX.length)] = window.localStorage.getItem(key);
      }
    }
    return snapshot;
  },
};

export default storage;
