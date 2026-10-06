const entries = new Map<string, string>();
const DAILY007_SESSION_KEY = "daily007_v2_session";
let rejectNextSessionWrite = false;
let sessionWriteAttempts = 0;
let rejectedSessionWrites = 0;

export const storage = {
  async getItem(key: string) {
    return entries.get(key) ?? null;
  },
  async setItem(key: string, value: string) {
    if (key === DAILY007_SESSION_KEY) {
      sessionWriteAttempts += 1;
      if (rejectNextSessionWrite) {
        rejectNextSessionWrite = false;
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
    rejectNextSessionWrite = false;
    sessionWriteAttempts = 0;
    rejectedSessionWrites = 0;
  },
  failNextSessionWrite() {
    rejectNextSessionWrite = true;
  },
  writeMetrics() {
    return { sessionWriteAttempts, rejectedSessionWrites };
  },
  snapshot() {
    return Object.fromEntries(entries.entries());
  },
};

export default storage;
