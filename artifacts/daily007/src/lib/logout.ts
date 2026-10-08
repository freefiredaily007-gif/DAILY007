export async function logoutDaily007(
  signOutClerk: (() => Promise<void>) | undefined,
  clearLocalSession: () => void | Promise<void>,
): Promise<boolean> {
  await clearLocalSession();
  try {
    await signOutClerk?.();
    return false;
  } catch {
    return true;
  }
}