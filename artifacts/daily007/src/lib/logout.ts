export async function logoutDaily007(
  signOutClerk: (() => Promise<void>) | undefined,
  clearLocalSession: () => void,
): Promise<boolean> {
  try {
    await signOutClerk?.();
    return false;
  } catch {
    return true;
  } finally {
    clearLocalSession();
  }
}