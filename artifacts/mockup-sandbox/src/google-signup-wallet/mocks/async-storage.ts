const entries = new Map<string, string>();

export const storage = {
  async getItem(key: string) {
    return entries.get(key) ?? null;
  },
  async setItem(key: string, value: string) {
    entries.set(key, value);
  },
  async removeItem(key: string) {
    entries.delete(key);
  },
  clear() {
    entries.clear();
  },
  snapshot() {
    return Object.fromEntries(entries.entries());
  },
};

export default storage;
