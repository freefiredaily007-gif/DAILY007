const entries = new Map<string, string>();
const DAILY007_SESSION_KEY = "daily007_v2_session";
let rejectedSessionWritesRemaining = 0;
let sessionWriteAttempts = 0;
let rejectedSessionWrites = 0;
let holdNextSessionWrite = false;
let heldSessionWriteResolver: (() => void) | null = null;

export const storage = {
  async getItem(key: string) {
    return entries.get(key) ?? null;
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
  },
  async removeItem(key: string) {
    entries.delete(key);
  },
  clear() {
    heldSessionWriteResolver?.();
    heldSessionWriteResolver = null;
    entries.clear();
    rejectedSessionWritesRemaining = 0;
    sessionWriteAttempts = 0;
    rejectedSessionWrites = 0;
    holdNextSessionWrite = false;
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
    entries.set(DAILY007_SESSION_KEY, JSON.stringify(session));
  },
  writeMetrics() {
    return { sessionWriteAttempts, rejectedSessionWrites };
  },
  snapshot() {
    return Object.fromEntries(entries.entries());
  },
};

export default storage;
