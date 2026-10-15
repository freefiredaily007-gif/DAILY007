export async function runOnceWhileInFlight<T>(
  inFlight: Set<string>,
  key: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  if (inFlight.has(key)) return undefined;
  inFlight.add(key);
  try {
    return await action();
  } finally {
    inFlight.delete(key);
  }
}
