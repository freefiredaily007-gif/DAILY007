const entries = new Map<string, string>();
const DAILY007_SESSION_KEY = "daily007_v2_session";
let rejectedSessionWritesRemaining = 0;
let sessionWriteAttempts = 0;
let rejectedSessionWrites = 0;

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
    }
    entries.set(key, value);
  },
  async removeItem(key: string) {
    entries.delete(key);
  },
  clear() {
    entries.clear();
    rejectedSessionWritesRemaining = 0;
    sessionWriteAttempts = 0;
    rejectedSessionWrites = 0;
  },
  failNextSessionWrite() {
    this.failSessionWrites(1);
  },
  failSessionWrites(count: number) {
    rejectedSessionWritesRemaining += count;
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
