// Data source of the running app. 'test' = the seeded local store (/data/seed.json),
// 'real' = the deployed backend (/lib/backendUrl.ts). The builder's "Use test data /
// Use real backend data" switch rewrites this file; the APK build sets it too.
export const DATA_MODE: 'test' | 'real' = 'real';
