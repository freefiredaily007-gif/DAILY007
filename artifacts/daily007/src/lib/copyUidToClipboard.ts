export async function copyUidToClipboard(
  uid: string,
  writeClipboard: (value: string) => Promise<boolean>,
): Promise<boolean> {
  const value = String(uid ?? '').trim();
  if (!value) return false;

  try {
    return await writeClipboard(value);
  } catch {
    return false;
  }
}
